"""Collect recent successful project web artifacts without building project code."""
import io
import json
import shutil
import stat
import subprocess
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = {
    "blankdiss": ("appsyndroms/Blankdiss", "blankdiss.yml", "blankdiss-web"),
    # Daily data runs and manual web-only runs both produce this artifact.
    "insider": ("appsyndroms/Insider", None, "insider-web"),
    "treage": ("appsyndroms/Treage", "build-web.yml", "treage-web"),
    "reports": ("appsyndroms/Reports", None, "reports-web"),
}
REQUIRED = {"index.html", "koplage.html", "bedomning.html", "dataanalys.html", "style.css", "site.js", "data.json"}
REQUIRED_BY_PROJECT = {"treage": {"index.html"},
                       "reports": REQUIRED | {"saljlage.html", "kalender.html", "handelser.html"}}
MAX_BYTES = 100 * 1024 * 1024


def api(endpoint, binary=False):
    # gh owns redirect authentication. Never log tokens, signed download URLs or response bodies.
    result = subprocess.run(["gh", "api", endpoint], capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError("GitHub kunde inte lämna begärd artefaktinformation.")
    return result.stdout if binary else json.loads(result.stdout)


def find_artifact(repo, workflow, name, now=None):
    now = now or datetime.now(timezone.utc)
    source = f"actions/workflows/{workflow}/runs" if workflow else "actions/runs"
    runs = api(f"repos/{repo}/{source}?branch=main&status=success&per_page=30")
    for run in runs["workflow_runs"]:
        created = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
        if now - created > timedelta(hours=48):
            continue
        artifacts = api(f"repos/{repo}/actions/runs/{run['id']}/artifacts?per_page=100")
        for artifact in artifacts["artifacts"]:
            if artifact["name"] != name or artifact.get("expired"):
                continue
            return dict(artifact, run_id=run["id"], repository=repo)
    raise RuntimeError("Inget lyckat webbpaket från de senaste 48 timmarna.")


def extract_bundle(data, target, project):
    if len(data) > MAX_BYTES:
        raise ValueError("Webbpaketet är för stort.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(e.file_size for e in entries) > MAX_BYTES:
            raise ValueError("Webbpaketet överstiger tillåten storlek.")
        names = set()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            mode = entry.external_attr >> 16
            if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                    or ":" in entry.filename or stat.S_ISLNK(mode)
                    or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))):
                raise ValueError("Webbpaketet innehåller en otillåten sökväg eller filtyp.")
            if not entry.is_dir():
                if path.as_posix() in names:
                    raise ValueError("Webbpaketet innehåller duplicerade filer.")
                names.add(path.as_posix())
        required = REQUIRED_BY_PROJECT.get(project, REQUIRED) | ({"handelser.html"} if project == "insider" else set())
        if not required <= names or any(archive.getinfo(name).file_size == 0 for name in required):
            raise ValueError("Webbpaketet saknar obligatoriska filer.")
        archive.extractall(target)


def collect(root=ROOT):
    root = Path(root)
    dist = root / "dist"
    if dist.is_symlink():
        raise ValueError("dist får inte vara en symbolisk länk.")
    receipts, failures = {}, []
    with tempfile.TemporaryDirectory(dir=root) as directory:
        staging = Path(directory)
        for project, (repo, workflow, name) in PROJECTS.items():
            try:
                artifact = find_artifact(repo, workflow, name)
                content = api(f"repos/{repo}/actions/artifacts/{artifact['id']}/zip", binary=True)
                extract_bundle(content, staging / project, project)
                receipts[project] = {"repository": repo, "run_id": artifact["run_id"],
                    "artifact_id": artifact["id"], "created_at": artifact["created_at"]}
            except (RuntimeError, ValueError, zipfile.BadZipFile, subprocess.TimeoutExpired) as error:
                failures.append(project)
                print(f"::warning::{project}: webbpaket saknas eller kunde inte verifieras ({type(error).__name__}).")
        if not receipts:
            raise RuntimeError("Inga färdiga projektwebbar kunde hämtas.")
        dist.mkdir(exist_ok=True)
        for project in PROJECTS:
            destination = dist / project
            if destination.is_symlink():
                raise ValueError("Projektkatalogen får inte vara en symbolisk länk.")
        for project in PROJECTS:
            destination = dist / project
            # Only these generated project directories are replaced; other producers are preserved.
            if destination.exists():
                shutil.rmtree(destination)
            if project in receipts:
                shutil.move(str(staging / project), destination)
                print(f"{project}: hämtat körning {receipts[project]['run_id']}")
    local = root / ".local"
    local.mkdir(exist_ok=True)
    (local / "artifact-receipts.json").write_text(json.dumps({"projects": receipts,
        "missing": failures, "collected_at": datetime.now(timezone.utc).isoformat()}, indent=2) + "\n")
    return receipts


if __name__ == "__main__":
    collect()
