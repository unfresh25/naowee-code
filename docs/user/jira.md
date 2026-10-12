# Jira

Open **Jira** from the sidebar to see your Jira issues next to your threads. It lists issues from
every Jira site you connect, grouped by status.

## Connect a site

1. Create an API token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).
   Use **Create API token**, not the scoped kind, which only works through Atlassian's gateway.
2. In **Settings → Integrations → Jira**, choose **Add site** and enter the site address
   (for example `your-team.atlassian.net`), your Atlassian email, and the token.

Repeat for each site you work with. The token is kept in the server's secret store and never
reaches your browser or phone. Atlassian tokens expire; when one does, the site shows an error
until you paste a new token with **Edit**.

## Work with issues

- Switch between the list and the board in the top-right corner. When the issues on screen
  belong to one project, or you pick one under **Project**, the board uses that project's Jira
  board columns, empty ones included; otherwise it shows one column per status. Pick another of
  the project's boards from the board menu. Drag a card to another column to move it; columns its
  workflow cannot reach from the current status fade while you drag. The board always includes
  issues finished in the last 30 days.
- **Assigned**, **Created**, and **All** choose whose issues to list. Done issues are hidden
  unless you turn on **Show done**, which adds those updated in the last 30 days.
- Select an issue to change its status, priority, or assignee, rename it, and read or add
  comments. Comments accept Markdown.
- **Start thread** opens a new thread in the project you pick, with the issue's link, details, and
  description already in the composer. Naowee remembers the project for each Jira project.
- **New issue** creates an issue in any project you can access.

Press `j` and `k` (or the arrow keys) to move between issues, `c` to create one, and `Esc` to close
the open issue. Each site shows its 100 most recently updated matches; search to reach older ones.
