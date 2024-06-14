# Discord Music Bot

I got tired of the bigger discord music bots always getting shut down so I made my own. It plays music, pauses, skips, and has a queue. Probably don't invite yours to a bunch of servers or it'll probably get shut down too

## Commands

- `!play <URL|query>`: Play some tunes.
- `!pause`: Pause/resume.
- `!skip`: Skip the current song.
- `!queue [page]`: Show the queue.
- `!clear`: Clear the queue.
- `!disconnect`: Disconnect and clear the queue.

## Setup

1. Clone the repo:
    ```bash
    git clone https://github.com/your-username/discord-music-bot.git
    cd discord-music-bot
    ```

2. Install the stuff:
    ```bash
    npm install
    ```

3. Add your bot token:
    ```bash
    DISCORD_BOT_TOKEN=your-bot-token
    ```

4. Start it up:
    ```bash
    node bot.js
    ```
