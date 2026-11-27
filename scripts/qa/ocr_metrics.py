"""Strict one-to-one OCR token scoring on *exhaustively annotated* text.

Do not use for the generated corpus's partial `expect.tokens`: unannotated text would be
incorrectly counted as false positives. Numbers and Cyrillic words are scored separately.
"""
from __future__ import annotations
from collections import Counter
import re

NUMBER = re.compile(r'\d+(?:[.,]\d+)?')
CYRILLIC = re.compile(r'[а-яё]+', re.IGNORECASE)


def score(reference: str, predicted: str) -> dict:
    result = {}
    for name, pattern in [('numbers', NUMBER), ('cyrillic', CYRILLIC)]:
        truth = Counter(pattern.findall(reference.casefold()))
        actual = Counter(pattern.findall(predicted.casefold()))
        tp = sum((truth & actual).values())
        expected = sum(truth.values())
        predicted_count = sum(actual.values())
        result[name] = {
            'truePositive': tp,
            'falsePositive': predicted_count - tp,
            'falseNegative': expected - tp,
            'precision': tp / predicted_count if predicted_count else None,
            'recall': tp / expected if expected else None,
        }
    return result
