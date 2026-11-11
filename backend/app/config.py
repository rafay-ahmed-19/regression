"""Runtime settings, read from environment variables or backend/.env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    mongo_url: str = "mongodb://localhost:27017"
    db_name: str = "regression_hub"
    cors_origins: str = "http://localhost:5173"

    # Set to true to load demo suites and a run history into an empty database at start-up.
    seed_demo: bool = False
    # Multiplier for simulated step and query durations. 0 makes runs instant.
    sim_speed: float = 1.0

    # AI failure analysis. If no key is set here the Anthropic SDK falls back to
    # its own credential lookup (environment, `ant auth login` profile).
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5-5"

    # Built front end to serve from the API process (optional).
    static_dir: str = str(BACKEND_DIR.parent / "frontend" / "dist")


@lru_cache
def get_settings() -> Settings:
    return Settings()
