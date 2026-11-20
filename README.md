# YodieLand

Static public archive for Mason's Club, deployed with GitHub Pages.

Repository: <https://github.com/IsaiahArellano/YodieLand>

## Members and staff

The site is read-only. Posts and jobs are stored in `site/YodieLand-data.json`; `authorRole` can be `member` or `staff` to show a display-only badge. Updates are made by editing that file and committing to `main`. Repository access controls who can publish updates. There is no site sign-in, server, or live-posting API in this static version.

Visitors can send a story or correction through the info form, which opens an email to the club desk.

## GitHub Pages

The workflow in `.github/workflows/pages.html` publishes the `site/` folder after each push to `main`. Set Pages source to **GitHub Actions**. The public site URL is <https://isaiaharellano.github.io/YodieLand/>.
