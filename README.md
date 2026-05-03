# CircleWatch

CircleWatch is a consent-based family safety web app. A family member creates a private circle, shares the invite link, and each person can choose to share live location from their own phone browser.

It does not track people from a phone number, call, or SMS. SMS is only used to send an invite link.

## Run locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## How to use

1. Create a circle.
2. Copy the invite link or use "Send invite by SMS".
3. Each family member opens the link on their own phone.
4. They enter a display name and enable Live sharing.

## Publish

This app can be deployed to a Node host such as Render, Railway, Fly.io, or a VPS. For production, add persistent storage such as SQLite or Postgres because the included server keeps circles in memory.

## Privacy notes

- Location sharing requires browser geolocation permission.
- Turning off Live sharing removes that user's current location from the map.
- Empty rooms expire automatically after 12 hours.
- Do not use this app to track anyone without clear consent.
