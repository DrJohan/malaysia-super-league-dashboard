# Malaysia Super League Match Centre

A static, mobile-friendly Malaysia Super League dashboard designed for GitHub Pages. It displays standings, live scores, the running match clock, recent results and upcoming fixtures using the official Malaysian Football League competition feed.

## How updates work

- The browser checks the official schedule every 30 seconds for score and match-status changes.
- GitHub Actions refreshes the full official snapshot and live-clock anchor every five minutes.
- The visible match clock continues ticking between snapshots and re-synchronises at the next deployment.
- Scheduled GitHub Actions runs may occasionally be delayed by GitHub; the page preserves the most recent verified snapshot.

## Enable GitHub Pages once

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open **Actions**, select **Refresh data and deploy GitHub Pages**, and run it once if it did not start automatically.

The expected address is:

`https://drjohan.github.io/malaysia-super-league-dashboard/`

## Data source

Competition data is retrieved from the Malaysian Football League's official Genius Sports-powered schedule and live-data feeds. This independent dashboard is not affiliated with or endorsed by MFL.
