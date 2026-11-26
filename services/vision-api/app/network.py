"""LAN-адреса цехового ПК: тот самый `http://192.168.x.y:8000`, который вписывают в QR.

Определение не требует psutil и не отправляет пакетов: UDP-сокет «подключается» к внешнему
адресу (ядро выбирает исходящий интерфейс и не шлёт ни байта), а имя хоста и переменная
`IKGUIDE_LAN_IP` дают запасные варианты. Если ничего не нашли — остаётся loopback, и об
этом честно сообщается в ответе.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from dataclasses import dataclass
from typing import Callable, Iterable

PRIMARY_PROBE_TARGET = ("8.8.8.8", 80)


@dataclass(frozen=True)
class LocalAddress:
    ip: str
    kind: str  # lan | link-local | loopback | other
    primary: bool = False

    def as_dict(self) -> dict[str, object]:
        return {"ip": self.ip, "kind": self.kind, "primary": self.primary}


def _classify(ip: str) -> str:
    try:
        address = ipaddress.IPv4Address(ip)
    except ipaddress.AddressValueError:
        return "other"
    if address.is_loopback:
        return "loopback"
    if address.is_link_local:
        # 169.254.x.x с телефона почти никогда не открывается: это адрес «нет сети», а не цеха.
        return "link-local"
    if address.is_private:
        return "lan"
    return "other"


def _primary_probe() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.settimeout(0.2)
            probe.connect(PRIMARY_PROBE_TARGET)
            return probe.getsockname()[0]
    except OSError:
        return None


def _hostname_addresses() -> list[str]:
    try:
        hostname = socket.gethostname()
        _name, _aliases, addresses = socket.gethostbyname_ex(hostname)
        return [ip for ip in addresses if ip]
    except OSError:
        return []


def _env_addresses() -> list[str]:
    raw = os.environ.get("IKGUIDE_LAN_IP", "")
    return [part.strip() for part in raw.replace(";", ",").split(",") if part.strip()]


def collect_addresses(
    probe: Callable[[], str | None] = _primary_probe,
    hostname_lookup: Callable[[], list[str]] = _hostname_addresses,
    extra: Iterable[str] | None = None,
) -> list[LocalAddress]:
    """Собирает адреса, первым идёт тот, через который цех реально видит сервис."""

    primary = probe()
    candidates: list[str] = []
    if primary:
        candidates.append(primary)
    candidates.extend(extra if extra is not None else _env_addresses())
    candidates.extend(hostname_lookup())

    seen: set[str] = set()
    result: list[LocalAddress] = []
    for ip in candidates:
        try:
            normalized = str(ipaddress.IPv4Address(ip))
        except ipaddress.AddressValueError:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(LocalAddress(ip=normalized, kind=_classify(normalized), primary=normalized == primary))

    if not result:
        result.append(LocalAddress(ip="127.0.0.1", kind="loopback", primary=True))

    rank = {"lan": 0, "link-local": 1, "other": 2, "loopback": 3}
    ordered = sorted(result, key=lambda address: (rank.get(address.kind, 2), not address.primary))
    if not any(address.primary for address in ordered):
        # Гору пришлось выдумать: делаем первый LAN-адрес основным, чтобы UI не остался без подсказки.
        first = ordered[0]
        ordered[0] = LocalAddress(ip=first.ip, kind=first.kind, primary=True)
    return ordered


def network_info(service_port: int | None = None) -> dict[str, object]:
    addresses = collect_addresses()
    primary = next((address.ip for address in addresses if address.primary), addresses[0].ip)
    port = service_port or 8000
    return {
        "status": "ok",
        "hostname": socket.gethostname(),
        "primary": primary,
        "primaryIsLan": next((address.kind == "lan" for address in addresses if address.primary), False),
        "addresses": [address.as_dict() for address in addresses],
        "guidePort": port,
        "suggestedApiBase": f"http://{primary}:{port}",
    }
