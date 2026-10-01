# CAO 2027 workshop website

One-page website for **The 2nd Workshop on Catch, Adapt, and Operate (CAO): Reliability Under Drift and Beyond**, under preparation for ICLR 2027. Plain HTML, CSS, and JavaScript with no build step, so it runs directly on GitHub Pages.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole site: about, themes, call for papers, dates, schedule, speakers and panel, organizers and reviewers, taking part (calls for reviewers and sponsors), games, CAO 2026 |
| `styles.css` | Styles |
| `play.js` | The game: *Keep it running* |
| `images/people/` | Headshots (see `PHOTO-FILENAMES.txt` for the exact names) |
| `.nojekyll` | Tells GitHub Pages to publish the files as they are |

## Photos

Put headshots in `images/people/` with the exact names in `images/people/PHOTO-FILENAMES.txt` (lowercase, `.jpg`). Until a photo exists, the page shows the person's initials.

## Publishing

Upload everything to the root of the repository (keep the `images/people/` folder). Pages is already set to deploy from `main` / root.

## Contact

caoiclr@gmail.com appears in the footer, the Taking part section, and the sponsor call. Reviewer sign-up goes to the Google Form in the Taking part section.
