"""FastAPI application entrypoint for the Callcenter scheduling app."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import assistant, auth, schedule, shift_types, teams, users

app = FastAPI(title="Callcenter Scheduling API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(teams.router)
app.include_router(users.router)
app.include_router(shift_types.router)
app.include_router(schedule.router)
app.include_router(schedule.my_schedule_router)
app.include_router(assistant.router)


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/api/health")
def health():
    return {"status": "ok"}
