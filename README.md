# CAO 2027 workshop website

Website for **The 2nd Workshop on Catch, Adapt, and Operate (CAO): Reliability Under Drift and Beyond**, under preparation for ICLR 2027. Plain HTML and CSS with no build step, so it runs directly on GitHub Pages.

## Pages

| File | Page |
|---|---|
| `index.html` | Home: overview, key dates, speakers, themes, CAO 2026 |
| `call-for-papers.html` | Topics, submission types, Lessons from Failures, Failure Clinic, review, LLM policy |
| `dates.html` | Tentative timeline |
| `schedule.html` | Tentative workshop-day schedule |
| `speakers.html` | Invited speakers and panel |
| `organizers.html` | Organizers and program committee (reviewer list) |
| `participate.html` | In-person policy, discussion channels, student support, awards, accessibility |
| `styles.css` | Shared styles for every page |

## Adding photos

Put headshots in `images/people/` using the exact file names listed in `images/people/PHOTO-FILENAMES.txt`
(for example `yoshua-bengio.jpg`). Names must be lowercase and end in `.jpg`, since GitHub Pages is case-sensitive.
Portrait or square images around 600×750 px work best; faces are framed from the upper part of the image.
Until a photo is added, the page shows the person's initials, so nothing looks broken.

## Publishing

Upload everything (keeping the `images/people/` folder) to the root of the repository, then
**Settings → Pages → Deploy from a branch → `main` / `(root)` → Save**.

## Editing

- **Menu, banner, footer:** repeated at the top and bottom of each `.html` file; change them in every page.
- **Contact email:** caoiclr@gmail.com, in each page footer and in the reviewer box.
- **Reviewers:** the `reviewers` list in the `<script>` at the bottom of `organizers.html`; the count updates automatically.
- **Speakers, panel, organizers:** the cards in `speakers.html` and `organizers.html`.
