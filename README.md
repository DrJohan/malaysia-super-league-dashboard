# Malaysian Football Match Centre

A static, mobile-friendly Malaysian football dashboard designed for GitHub Pages. It has separate match-centre pages for Liga Super, the Malaysia FA Cup and Liga A1 Semi-Pro.

- Liga Super: standings, live scores, running match clock, recent results, upcoming fixtures and short official MFL news updates.
- Malaysia FA Cup: knockout-stage progress, live scores, recent results, upcoming ties and competition-specific MFL news updates.
- Liga A1 Semi-Pro: a current league table, recent results, upcoming fixtures, live-score checks and short official AFL news updates.

## How updates work

- The Liga Super and FA Cup pages check their official schedules every 30 seconds for score and match-status changes.
- GitHub Actions refreshes the full official snapshot and live-clock anchor every five minutes.
- The visible match clock continues ticking between snapshots and re-synchronises at the next deployment.
- The A1 page checks Sofascore's published A1 feed every 30 seconds in the browser. GitHub Actions also combines official AFL fixtures and news with published standings and completed-result fallbacks, so delayed GitHub schedules do not leave the page stuck on its opening snapshot.
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

The FA Cup page is:

`https://drjohan.github.io/malaysia-super-league-dashboard/fa-cup/`

## Data source

Liga Super and Malaysia FA Cup data are retrieved from the Malaysian Football League's official Genius Sports-powered schedule and live-data feeds. Liga A1 fixtures and news are retrieved from the official Amateur Football League website; score and standings updates use Sofascore with a FootyStats completed-result fallback. This independent dashboard is not affiliated with or endorsed by MFL, AFL, Sofascore or FootyStats.
