# CryoTriage Pilot Data Kit

Use this kit to request one anonymized cryo-EM screening session from a core facility or lab.

## Requested files

- 50-200 atlas, square, or hole images exported as `PNG`, `JPG`, `TIFF`, `MRC`, or `MRCS`
- A label CSV using `filename,label`
- Optional session metadata CSV

## Labels

Use three labels only:

- `collect`: clearly worth queueing for collection
- `review`: uncertain or operator-dependent
- `skip`: poor ice, empty/contaminated, bad support, or not worth collection

See [label_template.csv](./label_template.csv).

## Metadata

Use [session_metadata_template.csv](./session_metadata_template.csv) when possible. Avoid PHI, unpublished sample details, grant IDs, or sensitive user information.

## Data handling

The current web app processes images in-browser. No uploaded images are sent to a server. For formats browsers cannot read directly, use the converter script in `scripts/convert_mrc_to_png.py`.

## Pilot output

The app generates:

- Ranked collection queue
- Useful precision/recall when labels are available
- False-skip risk
- Estimated microscope minutes and dollars saved
- Downloadable pilot HTML report
