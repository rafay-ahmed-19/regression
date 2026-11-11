"""Evolv Regression Hub API."""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import db, ensure_indexes
from .routers import baselines, imports, insights, oracle_connections, runs, suites, test_points
from .services import runner
from .services.seed import seed_demo

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("hub")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if db.handle is None:
        db.connect()
    await ensure_indexes()
    await runner.recover_interrupted()
    if settings.seed_demo and await seed_demo():
        log.info("Loaded demo suites and run history")
    yield
    await db.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Evolv Regression Hub", version="1.0.0", lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                       allow_methods=["*"], allow_headers=["*"])
    for module in (suites, imports, test_points, runs, baselines, insights, oracle_connections):
        app.include_router(module.router, prefix="/api")

    @app.get("/api/health", tags=["meta"])
    async def health():
        return {"status": "ok"}

    # Serve the built front end from the same process when it is present.
    static = Path(settings.static_dir)
    if (static / "index.html").is_file():
        if (static / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "Not found")
            file = (static / path).resolve()
            if path and file.is_file() and static.resolve() in file.parents:
                return FileResponse(file)
            return FileResponse(static / "index.html")

    return app


app = create_app()
