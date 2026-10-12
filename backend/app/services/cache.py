"""Tiny TTL cache for expensive dashboard aggregations. Cleared on every committed stock change."""
import time

_store: dict = {}
TTL = 20


def get(key):
    item = _store.get(key)
    if item and item[0] > time.monotonic():
        return item[1]
    return None


def put(key, value):
    if len(_store) > 500:
        _store.clear()
    _store[key] = (time.monotonic() + TTL, value)


def clear():
    _store.clear()
