"""Request bodies."""
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

StepType = Literal["setup_sql", "load_data", "run_job", "unzip_inputs", "run_script", "validate"]
Scope = Literal["cell", "row", "test_point", "run"]


def _clean_list(values: list[str]) -> list[str]:
    seen, out = set(), []
    for v in values:
        v = str(v).strip()
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


class StepIn(BaseModel):
    id: str | None = None
    type: StepType
    name: str = Field(min_length=1, max_length=200)
    command: str = ""
    files: list[str] = []
    detail: dict[str, Any] = {}


class SuiteIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    build_folder: str = ""
    description: str = ""
    steps: list[StepIn] = []


class TestPointBase(BaseModel):
    @field_validator("tags", "impacted_by", "key_columns", "columns", "add_tags", "remove_tags", check_fields=False)
    @classmethod
    def _lists(cls, v):
        return _clean_list(v) if v is not None else v


class TestPointIn(TestPointBase):
    suite_id: str
    sheet_name: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    module: str = ""
    description: str = ""
    sql: str = ""
    columns: list[str] = Field(min_length=1)
    key_columns: list[str] = []
    tolerance: float = Field(default=0, ge=0)
    tags: list[str] = []
    owner: str = ""
    impacted_by: list[str] = []
    checkpoint_id: str | None = None
    # Expected rows that seed baseline v1. When omitted, sample rows are generated.
    rows: list[list[Any]] | None = None


class TestPointUpdate(TestPointBase):
    sheet_name: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    module: str | None = None
    description: str | None = None
    sql: str | None = None
    key_columns: list[str] | None = None
    tolerance: float | None = Field(default=None, ge=0)
    tags: list[str] | None = None
    owner: str | None = None
    impacted_by: list[str] | None = None
    checkpoint_id: str | None = None


class BulkIds(BaseModel):
    ids: list[str] = Field(min_length=1)


class BulkUpdate(TestPointBase):
    ids: list[str] = Field(min_length=1)
    owner: str | None = None
    module: str | None = None
    tolerance: float | None = Field(default=None, ge=0)
    add_tags: list[str] = []
    remove_tags: list[str] = []


class RunIn(BaseModel):
    suite_id: str
    branch: str
    impacted_only: bool = False
    user: str = ""


class AcceptIn(BaseModel):
    scope: Scope
    test_point_id: str | None = None
    row_key: str | None = None
    column: str | None = None
    reason: str = Field(min_length=3, max_length=500)
    user: str = Field(min_length=1, max_length=80)

    @field_validator("reason", "user")
    @classmethod
    def _strip(cls, v):
        return v.strip()


class RollbackIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    user: str = Field(min_length=1, max_length=80)


class SheetPatch(BaseModel):
    sql_row: int | None = Field(default=None, ge=0)  # 1-based; 0 clears it
    header_row: int | None = Field(default=None, ge=1)
    key_columns: list[str] | None = None
    included: bool | None = None


class ImportCommit(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    build_folder: str = ""
    description: str = ""
