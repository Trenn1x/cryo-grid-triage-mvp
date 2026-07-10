# Outreach Email

Subject: Quick cryo-EM grid triage pilot using one anonymized screening session

Hi {{name}},

I am building a lightweight pre-collection triage tool for cryo-EM screening images. The goal is practical: rank atlas/square/hole images before high-mag collection and estimate avoided microscope time without sending image data to a server.

Would you be open to sharing one anonymized historical screening session for a pilot benchmark?

Requested data:

- 50-200 atlas, square, or hole images
- Simple labels: `collect`, `review`, or `skip`
- Optional session metadata such as microscope type and rough hourly cost

What I will return:

- Ranked collection queue
- False-skip risk against your labels
- Useful precision/recall
- Estimated microscope minutes and dollars saved
- A short HTML pilot report you can review internally

Synthetic data is already supported for workflow demos, but I do not want to claim scientific value without real labeled facility data. One anonymized session is enough to tell whether this is worth deeper work.

Best,
Thomas
