"""Сторож родительского процесса: движок не должен переживать IKGuide Studio.

Проверяется и разбор аргументов, и сам цикл — без реальных процессов-зомби в диспетчере задач.
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine_entry import parent_alive, parent_pid_from, watch_parent  # noqa: E402


def test_parent_pid_from_flag_and_env(monkeypatch):
    assert parent_pid_from(["--parent-pid", "4242"]) == 4242
    assert parent_pid_from(["--parent-pid=777"]) == 777
    assert parent_pid_from([]) is None
    monkeypatch.setenv("IKGUIDE_PARENT_PID", "555")
    assert parent_pid_from([]) == 555
    monkeypatch.setenv("IKGUIDE_PARENT_PID", "not-a-pid")
    assert parent_pid_from([]) is None
    assert parent_pid_from(["--parent-pid", "0"]) is None
    assert parent_pid_from(["--parent-pid", "-5"]) is None


def test_current_process_is_alive():
    assert parent_alive(os.getpid()) is True


def test_finished_process_is_not_alive():
    child = subprocess.Popen([sys.executable, "-c", "pass"])
    child.wait()
    assert parent_alive(child.pid) is False


def test_watchdog_exits_when_parent_is_gone():
    exits: list[int] = []
    child = subprocess.Popen([sys.executable, "-c", "pass"])
    child.wait()
    watch_parent(child.pid, interval=0.01, exit_fn=exits.append)
    for _ in range(200):
        if exits:
            break
        import time

        time.sleep(0.01)
    assert exits == [0]


def test_watchdog_keeps_running_for_live_parent():
    exits: list[int] = []
    watch_parent(os.getpid(), interval=0.01, exit_fn=exits.append)
    import time

    time.sleep(0.15)
    assert exits == []
