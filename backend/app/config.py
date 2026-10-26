"""Application configuration — all secrets read from the environment."""
import os

from dotenv import load_dotenv

load_dotenv()

# Database — must be provided by the environment (pre-configured with
# search_path=bw_callcenter_1).
DATABASE_URL = os.environ.get("DATABASE_URL")

# JWT signing secret — never hardcode a real secret; fall back only for local dev.
JWT_SECRET = os.environ.get("JWT_SECRET")

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "720"))  # ~12h

# Database schema that owns every project table.
DB_SCHEMA = "bw_callcenter_1"


def require_database_url() -> str:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is not set.")
    return DATABASE_URL


def require_jwt_secret() -> str:
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET environment variable is not set.")
    return JWT_SECRET
