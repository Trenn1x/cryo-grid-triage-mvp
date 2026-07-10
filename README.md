# CryoTriage Pilot Console

Browser-based cryo-EM grid triage prototype. It ranks uploaded atlas/hole images, estimates avoided microscope time, and can recalibrate its scoring weights from pilot labels.

## Current MVP

- Batch image upload with drag/drop
- Demo set for immediate testing
- Seeded synthetic session generator for 8-160 images
- Client-side scoring only; uploaded images are not sent to a backend
- Metrics:
  - Sharpness proxy
  - Contrast proxy
  - Ice balance proxy
  - Tone alignment
  - Contamination/cleanliness proxy
- Ranked priorities:
  - `Collect now`
  - `Review`
  - `Skip`
- Label CSV import and in-browser calibration
- Validation stats for matched labels
- Time and cost savings estimates
- CSV export with scores, metrics, labels, weights, and ROI assumptions
- Label CSV export for synthetic sessions
- Pilot report preview and downloadable standalone HTML report

## Synthetic sessions

If real facility data is not available yet, use `Simulate Session`.

The simulator creates deterministic, browser-generated grid images with a configurable image count and seed. It also creates matching labels that can be exported as CSV. This is useful for workflow demos, sales discovery, UI testing, and calibration-loop validation.

Synthetic data is not evidence of scientific performance. Treat it as product simulation until labels from real sessions are available.

## Pilot report

After running triage, use `Pilot Report` to download a standalone HTML summary. The report includes:

- Collection/review/skip counts
- Estimated time and cost savings
- Validation metrics when labels are available
- Recommended collection queue
- Review queue
- Risk audit for false skips and false useful-queue items
- Scoring weights and suggested next actions

## Label CSV

Use a CSV with `filename` and `label` columns.

```csv
filename,label
grid_a_square_001.png,collect
grid_b_hole_014.png,review
grid_c_edge_009.png,skip
```

Accepted label values include:

- Collect: `collect`, `good`, `usable`, `accept`, `yes`, `1`
- Review: `review`, `maybe`, `inspect`, `borderline`, `0.5`
- Skip: `skip`, `bad`, `reject`, `unusable`, `empty`, `contaminated`, `no`, `0`

## Run locally

```bash
cd /Users/thomasverdier/cryo-grid-triage-mvp
python3 -m http.server 8081
```

Then open `http://127.0.0.1:8081`.

## Deploy on Vercel

```bash
cd /Users/thomasverdier/cryo-grid-triage-mvp
vercel --prod --yes --public
```

## Deploy on GitHub Pages

The app is static and can be deployed from the repository branch root through GitHub Pages.

The current deployment branch is `codex/cryo-grid-triage-pages-static`, served from `/`.

## Scientific note

This is a heuristic workflow MVP for pilot validation and ROI discovery. It is not a validated cryo-EM classifier. The next technical step is to collect labels from real facility sessions and train a supervised model against the same workflow outputs.
