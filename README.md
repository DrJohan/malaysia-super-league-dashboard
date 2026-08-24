# Malaysia Super League Match Centre

A static, mobile-friendly Malaysian football dashboard designed for GitHub Pages. It has separate match-centre pages for Liga Super and Liga A1 Semi-Pro.

- Liga Super: standings, live scores, running match clock, recent results, upcoming fixtures and short official MFL news updates.
- Liga A1 Semi-Pro: an MSL-style league table calculated from official completed fixtures, plus current-season results, upcoming fixtures and short official AFL news updates.

## How updates work

- The browser checks the official schedule every 30 seconds for score and match-status changes.
- GitHub Actions refreshes the full official snapshot and live-clock anchor every five minutes.
- The visible match clock continues ticking between snapshots and re-synchronises at the next deployment.
- The A1 page refreshes from the official AFL website every five minutes and retains earlier verified results from the deployed snapshot so its calculated table remains cumulative. A1 live clocks are shown only if a verified official feed becomes available.
- Each league page shows the three newest updates from its official source, with a short excerpt and a link to the original article. These refresh as part of the same five-minute GitHub Actions deployment.
- Scheduled GitHub Actions runs may occasionally be delayed by GitHub; the page preserves the most recent verified snapshot.

## Enable GitHub Pages once

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open **Actions**, select **Refresh data and deploy GitHub Pages**, and run it once if it did not start automatically.

The expected address is:

`https://drjohan.github.io/malaysia-super-league-dashboard/`

The A1 page is:

`https://drjohan.github.io/malaysia-super-league-dashboard/a1/`

## Data source

Liga Super data is retrieved from the Malaysian Football League's official Genius Sports-powered schedule and live-data feeds. Liga A1 data is retrieved from the official Amateur Football League website. This independent dashboard is not affiliated with or endorsed by MFL or AFL.
