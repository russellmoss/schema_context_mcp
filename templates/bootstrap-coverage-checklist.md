# Bootstrap Coverage Checklist

> Maps source documentation sections to config sections.
> Fill this in after running bootstrap to track what was extracted and what needs manual attention.

## Source Documents Provided

| Document | Path | Status |
|---|---|---|
| _example: field-dictionary.md_ | `docs/bootstrap/field-dictionary.md` | Processed |
| | | |
| | | |
| | | |

## Extraction Coverage

### Views

| View Name | Extracted From | Purpose Found | Grain Found | Needs Manual Review |
|---|---|---|---|---|
| _example: orders_summary_ | _field-dictionary.md_ | Yes | No | Yes — add grain |
| | | | | |
| | | | | |

### Fields

| Field Name | Extracted From | Meaning Found | Type Found | Needs Manual Review |
|---|---|---|---|---|
| _example: subtotal_price_ | _field-dictionary.md_ | Yes | Yes | No |
| | | | | |
| | | | | |

### Rules

| Rule Description | Extracted From | Typed Primitive Assigned | Needs Human Classification |
|---|---|---|---|
| _example: Do not use deleted_at directly_ | _patterns.md_ | No — draft only | Yes |
| | | | |
| | | | |

### Terms

| Term | Extracted From | Definition Found | Needs Manual Review |
|---|---|---|---|
| _example: AOV_ | _field-dictionary.md_ | Yes | No |
| | | | |
| | | | |

## Unrecognized Sections

> List markdown sections from source docs that the extractor did not match.
> These may contain valuable knowledge that needs manual extraction.

| Document | Section Heading | Suggested Config Section |
|---|---|---|
| | | |
| | | |

## Coverage Summary

- Views extracted: ____
- Fields extracted: ____
- Rules extracted: ____
- Terms extracted: ____
- Unrecognized sections: ____
- Estimated manual effort remaining: ____
