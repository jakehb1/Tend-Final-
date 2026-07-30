import os
import sys

_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None

_CODES = {
    "reset": "\033[0m",
    "dim": "\033[2m",
    "bold": "\033[1m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "red": "\033[31m",
    "blue": "\033[34m",
    "cyan": "\033[36m",
    "magenta": "\033[35m",
}


def c(text: str, color: str) -> str:
    if not _COLOR:
        return text
    return f"{_CODES[color]}{text}{_CODES['reset']}"


def ok(text: str) -> str:
    return f"{c('✔', 'green')} {text}"


def warn(text: str) -> str:
    return f"{c('!', 'yellow')} {text}"


def err(text: str) -> str:
    return f"{c('✗', 'red')} {text}"


def dim(text: str) -> str:
    return c(text, "dim")


def bold(text: str) -> str:
    return c(text, "bold")


def plan_line(kind: str, body: str) -> str:
    if kind == "+":
        return f"{c('+', 'green')} {body}"
    if kind == "-":
        return f"{c('-', 'red')} {body}"
    if kind == "~":
        return f"{c('~', 'yellow')} {body}"
    return f"  {body}"


def table(headers, rows):
    widths = [len(h) for h in headers]
    for r in rows:
        for i, cell in enumerate(r):
            widths[i] = max(widths[i], len(str(cell)))
    fmt = "  ".join("{:<" + str(w) + "}" for w in widths)
    out = [bold(fmt.format(*headers))]
    out.append(dim("  ".join("-" * w for w in widths)))
    for r in rows:
        out.append(fmt.format(*[str(cell) for cell in r]))
    return "\n".join(out)
