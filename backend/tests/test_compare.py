import pytest

from app.services.compare import apply_acceptance, compare, row_keys

COLS = ["ID", "CCY", "AMOUNT"]
BASE = [["A", "USD", 100.0], ["B", "EUR", 200.0], ["C", "GBP", 300.0]]


def test_row_order_does_not_matter_with_keys():
    out = compare(COLS, ["ID"], BASE, BASE[::-1])
    assert out["diffs"] == [] and out["matched"] == 3


def test_position_matching_without_keys():
    out = compare(COLS, [], BASE, BASE[::-1])
    assert [d["type"] for d in out["diffs"]] == ["modified", "modified"]
    assert out["diffs"][0]["key"] == "1"


def test_modified_missing_and_extra_are_classified():
    actual = [["A", "USD", 100.0], ["B", "EUR", 250.0], ["D", "JPY", 1.0]]
    out = compare(COLS, ["ID"], BASE, actual)
    by_key = {d["key"]: d for d in out["diffs"]}
    assert by_key["B"]["type"] == "modified" and by_key["B"]["cells"] == ["AMOUNT"]
    assert by_key["C"]["type"] == "missing" and by_key["C"]["actual"] is None
    assert by_key["D"]["type"] == "extra" and by_key["D"]["expected"] is None
    assert out["matched"] == 1 and out["expected_count"] == 3 and out["actual_count"] == 3


def test_numeric_tolerance():
    actual = [["A", "USD", 100.004], ["B", "EUR", 200.0], ["C", "GBP", 300.02]]
    assert len(compare(COLS, ["ID"], BASE, actual)["diffs"]) == 2
    out = compare(COLS, ["ID"], BASE, actual, tolerance=0.01)
    assert [d["key"] for d in out["diffs"]] == ["C"]


def test_tolerance_does_not_apply_to_text_and_int_equals_float():
    assert compare(["K", "V"], ["K"], [["a", "x"]], [["a", "y"]], tolerance=5)["diffs"]
    assert not compare(["K", "V"], ["K"], [["a", 1]], [["a", 1.0]])["diffs"]


def test_composite_and_duplicate_keys():
    rows = [["UK", "USD", 1], ["UK", "EUR", 2], ["UK", "EUR", 3]]
    assert row_keys(rows, ["E", "C", "V"], ["E", "C"]) == ["UK | USD", "UK | EUR", "UK | EUR #2"]


def test_accept_row_cell_missing_and_extra():
    actual = [["A", "EUR", 111.0], ["B", "EUR", 200.0], ["D", "JPY", 1.0]]
    cell = apply_acceptance(COLS, ["ID"], BASE, actual, "A", "AMOUNT")
    assert cell[0] == ["A", "USD", 111.0]
    assert apply_acceptance(COLS, ["ID"], BASE, actual, "A")[0] == ["A", "EUR", 111.0]
    assert [r[0] for r in apply_acceptance(COLS, ["ID"], BASE, actual, "C")] == ["A", "B"]
    assert apply_acceptance(COLS, ["ID"], BASE, actual, "D")[-1] == ["D", "JPY", 1.0]
    assert BASE[0] == ["A", "USD", 100.0]  # input untouched
    with pytest.raises(ValueError):
        apply_acceptance(COLS, ["ID"], BASE, actual, "C", "AMOUNT")
    with pytest.raises(ValueError):
        apply_acceptance(COLS, ["ID"], BASE, actual, "ZZ")


def test_number_in_excel_equals_same_number_as_text_from_oracle():
    from app.services.compare import values_equal
    assert values_equal(100100, "100100") and values_equal("2500.50", 2500.5) and values_equal(7, " 7 ")
    assert values_equal(100.0, "100.004", 0.01) and not values_equal(100, "100.5")
    assert not values_equal(100100, "100100A") and not values_equal(0, "") and not values_equal(1, "1e3")
    assert not values_equal("00123", "123")  # two texts are compared exactly
    assert not values_equal(True, "1")
