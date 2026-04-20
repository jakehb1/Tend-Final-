import json
import re
from pathlib import Path


def project_root(start: Path | None = None) -> Path:
    p = (start or Path.cwd()).resolve()
    for candidate in [p, *p.parents]:
        if (candidate / "tend.toml").exists():
            return candidate
    return Path.cwd()


def schema_dir(root: Path | None = None) -> Path:
    return (root or project_root()) / "schema"


def policies_dir(root: Path | None = None) -> Path:
    return (root or project_root()) / "policies"


def local_dot_tend(root: Path | None = None) -> Path:
    d = (root or project_root()) / ".tend"
    d.mkdir(exist_ok=True)
    return d


def read_config() -> dict:
    root = project_root()
    cfg_path = root / "tend.toml"
    if not cfg_path.exists():
        return {}
    return _parse_toml(cfg_path.read_text())


def _parse_toml(text: str) -> dict:
    """Tiny TOML reader — enough for the sandbox config shape."""
    out: dict = {}
    cur = out
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            keys = line[1:-1].split(".")
            cur = out
            for k in keys:
                cur = cur.setdefault(k.strip(), {})
            continue
        if "=" not in line:
            continue
        k, v = (x.strip() for x in line.split("=", 1))
        cur[k] = _coerce(v)
    return out


def _coerce(v: str):
    if v.startswith('"') and v.endswith('"'):
        return v[1:-1]
    if v in ("true", "false"):
        return v == "true"
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v


# --- schema parsing (pattern-based; tolerant, not a real compiler) ---


_ENTITY_RE = re.compile(r"^\s*entity\s+(\w+)\s*\{", re.MULTILINE)
_RELATION_RE = re.compile(r":\s*(?:\w+\s+via|collection<\w+>)")
_COMPUTED_RE = re.compile(r":\s*computed\s*\{")
_FIELD_RE = re.compile(r"^\s*\w+\s*:\s*\w", re.MULTILINE)


def summarize_schema(root: Path | None = None) -> dict:
    d = schema_dir(root)
    entities: list[str] = []
    relations = 0
    computed = 0
    fields = 0
    files: list[Path] = []
    if d.exists():
        for f in sorted(d.glob("*.tend")):
            files.append(f)
            text = f.read_text()
            entities.extend(_ENTITY_RE.findall(text))
            relations += len(_RELATION_RE.findall(text))
            computed += len(_COMPUTED_RE.findall(text))
            fields += len(_FIELD_RE.findall(text))
    return {
        "entities": entities,
        "n_entities": len(entities),
        "n_relations": relations,
        "n_computed": computed,
        "n_fields": fields,
        "files": files,
    }


def write_plan(plan: dict) -> Path:
    out = local_dot_tend() / "plan.json"
    out.write_text(json.dumps(plan, indent=2))
    return out


def read_plan(path: Path | None = None) -> dict | None:
    p = path or (local_dot_tend() / "plan.json")
    if not p.exists():
        return None
    return json.loads(p.read_text())
