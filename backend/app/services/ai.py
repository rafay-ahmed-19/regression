"""AI failure analysis streamed from Claude (FR-23).

Only failing rows are sent: at most MAX_DIFFS differences, and for each one just
the key and the cells that differ. Whole result sets never leave the Hub.
"""
import logging
import os

import anthropic

from ..config import get_settings

log = logging.getLogger(__name__)

MAX_DIFFS = 25
MAX_CELLS = 8
FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Models that can hand a declined request to another model inside the same call.
FALLBACK_MODELS = {"claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1"}

SYSTEM = """You are a senior QA analyst reviewing a failed regression test point for the Evolv accounting module.
A test point is an Oracle query whose result is compared, row by row on key columns, with an approved baseline.

Write a concise markdown analysis with exactly these sections, each as a level-3 heading:
### Summary
One or two sentences on what changed.
### Failure patterns
Group similar differences (same column, same direction, same size, missing or extra rows). Quote real keys and values.
### Likely root cause
Tie the pattern to the changed files when that is plausible. Say so plainly when the evidence does not point anywhere.
### Verdict
Exactly one of: **Real defect**, **Expected change - safe to accept as baseline**, **Flaky - re-run**. Add one sentence of justification.
### Next steps
At most three bullets.

Stay under 250 words. Use only the data provided; do not invent rows, files or history."""


def is_configured() -> bool:
    return bool(get_settings().anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
                or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def build_prompt(run: dict, result: dict, history: list[dict]) -> str:
    cols = result["columns"]
    lines = []
    for d in result["diffs"][:MAX_DIFFS]:
        if d["type"] == "modified":
            cells = ", ".join(f"{c}: {d['expected'][cols.index(c)]!r} -> {d['actual'][cols.index(c)]!r}"
                              for c in d["cells"][:MAX_CELLS])
            more = f" (+{len(d['cells']) - MAX_CELLS} more columns)" if len(d["cells"]) > MAX_CELLS else ""
            lines.append(f"- key={d['key']} modified: {cells}{more}")
        else:
            row = d["expected"] if d["type"] == "missing" else d["actual"]
            side = "in baseline, not in actual" if d["type"] == "missing" else "in actual, not in baseline"
            lines.append(f"- key={d['key']} {d['type']} ({side}): "
                         + ", ".join(f"{c}={v!r}" for c, v in list(zip(cols, row))[:MAX_CELLS]))
    recent = ", ".join(f"{h['branch']}@{h['commit']}:{h['status']}(baseline v{h['baseline_version']})"
                       for h in history[-10:][::-1]) or "none"
    changed = "\n".join(f"- {f}" for f in run["changed_files"]) or "- (none)"
    return (
        f"Test point: {result['sheet_name']} ({result['name']}), module {result.get('module') or '-'}\n"
        f"Suite: {run['suite_name']}\n"
        f"Build: {run['branch']}" + (f" at commit {run['commit']}" if run.get("commit") else "") + "\n\n"
        f"Oracle SQL:\n{result.get('sql') or '(not recorded)'}\n\n"
        f"Key columns: {', '.join(result['key_columns']) or '(none, matched by position)'}\n"
        f"Numeric tolerance: ±{result['tolerance']}\n"
        f"Baseline v{result['baseline_version']}: {result['expected_count']} rows. "
        f"Actual: {result['actual_count']} rows. Matched: {result['matched']}.\n\n"
        + (f"Files changed on this branch versus main:\n{changed}\n\n" if run.get("mode") != "oracle"
           else "Changed files are not known for this run.\n\n") +
        f"Recent results for this test point, newest first: {recent}\n\n"
        f"Differences ({result['diff_count']} in total, first {len(lines)} shown):\n" + "\n".join(lines)
    )


async def stream_explanation(prompt: str):
    """Yield ("text", chunk) pieces, then one ("done", full_text) or ("error", message)."""
    settings = get_settings()
    request = dict(
        model=settings.anthropic_model,
        max_tokens=8000,
        system=SYSTEM,
        output_config={"effort": "medium"},
        messages=[{"role": "user", "content": prompt}],
    )
    if settings.anthropic_model in FALLBACK_MODELS:
        request.update(betas=[FALLBACK_BETA], fallbacks="default")
    full = ""
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key \
            else anthropic.AsyncAnthropic()
        async with client.beta.messages.stream(**request) as stream:
            async for text in stream.text_stream:
                full += text
                yield "text", text
            final = await stream.get_final_message()
        if final.stop_reason == "refusal":
            yield "error", "The model declined to analyse this failure."
        elif not full.strip():
            yield "error", "The model returned no analysis. Please try again."
        else:
            yield "done", full
    except anthropic.AuthenticationError:
        yield "error", "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server."
    except anthropic.PermissionDeniedError:
        yield "error", f"This API key is not allowed to use {settings.anthropic_model}."
    except anthropic.NotFoundError:
        yield "error", f"Model '{settings.anthropic_model}' was not found. Check ANTHROPIC_MODEL."
    except anthropic.RateLimitError:
        yield "error", "The AI service is rate limited right now. Try again in a minute."
    except anthropic.APIStatusError as exc:
        log.warning("AI analysis failed: %s", exc)
        yield "error", f"The AI service returned an error ({exc.status_code}). Please try again shortly."
    except anthropic.APIConnectionError:
        yield "error", "Could not reach the AI service from the server."
    except (anthropic.AnthropicError, TypeError) as exc:
        # The SDK raises TypeError when it cannot find any credentials.
        log.warning("AI analysis unavailable: %s", exc)
        yield "error", "AI analysis is not configured. Set ANTHROPIC_API_KEY on the server."
