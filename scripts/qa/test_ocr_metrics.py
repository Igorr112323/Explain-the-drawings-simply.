from ocr_metrics import score


def test_one_to_one_and_empty_denominators():
    result = score('Сталь 10 10', 'сталь 10 11')
    assert result['numbers']['truePositive'] == 1
    assert result['numbers']['falsePositive'] == 1
    assert result['numbers']['falseNegative'] == 1
    assert result['numbers']['precision'] == .5
    assert result['numbers']['recall'] == .5
    assert score('', '')['cyrillic']['precision'] is None
