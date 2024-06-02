const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytpl = require('ytpl'); // Make sure ytpl is installed
const ffmpeg = require('ffmpeg-static');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const queue = new Map();
const quips = [
    'https://www.youtube.com/watch?v=UZ7UhYKPug8',
    'https://www.youtube.com/watch?v=mkOZH_DOJhc',
    'https://www.youtube.com/watch?v=EwDrmA6Fuic',
    'https://www.youtube.com/watch?v=5z0JiIx1B_o',
    'https://www.youtube.com/watch?v=ni7PXrsOaDo',
    'https://www.youtube.com/watch?v=1RM3uEnQ24E',
    'https://www.youtube.com/watch?v=maEMqGcBWns',
    'https://www.youtube.com/watch?v=B_MPo3uMbAg',
    'https://www.youtube.com/watch?v=-CGclHVZ_v0',
    'https://www.youtube.com/watch?v=nkU5_zphfi4',
    'https://www.youtube.com/watch?v=XKBBtOHIfGE',
    'https://www.youtube.com/watch?v=4ui4lB5_hr8',
    'https://www.youtube.com/watch?v=NsfHZq2R4-o',
    'https://www.youtube.com/watch?v=kRZ59ouVX9c',
    'https://www.youtube.com/watch?v=HBsvkKtlSh4',
    'https://www.youtube.com/watch?v=F-UYK-LUKLo',
    'https://www.youtube.com/watch?v=77cCqTuj3uE',
    'https://www.youtube.com/watch?v=Mq1ldxAz24g',
    'https://www.youtube.com/watch?v=eYr2A79t_jk'
];

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.bot) return;
    const args = message.content.slice(1).split(' ');
    const command = args.shift().toLowerCase();
    if (command === 'play') {
        await handlePlayCommand(message, args);
    } else if (command ==='pause') {
        await handlePauseCommand(message);
    } else if (command === 'skip') {
        await handleSkipCommand(message);
    } else if (command === 'queue') {
        await handleQueueCommand(message, args);
    } else if (command === 'disconnect') {
        const guildId = message.guild.id;
        gracefulDisconnect(guildId);
        message.channel.send('Disconnected successfully.');
    }
});


async function handlePlayCommand(message, args) {
    const guildId = message.guild.id;
    const serverQueue = queue.get(message.guild.id);

    console.log(`Received play command from ${message.author.username} in guild ${message.guild.name}`);

    const songInfo = await ytdl.getInfo(args[0]);
    const song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        requester: message.author.username,
    };

    console.log(`Attempting to play song: ${song.title} requested by ${song.requester}`);

    if (!serverQueue) {
        console.log(`No existing queue in guild ${message.guild.name}, creating new one`);
        // Create queue if it doesn't exist
        const queueConstruct = {
            textChannel: message.channel,
            voiceChannel: message.member.voice.channel,
            connection: null,
            player: createAudioPlayer(),
            songs: [],
            playing: true,
            idle: true, // Set the idle flag to true initially
            timeoutHandle: null,
            lastPlayTimestamp: null
        };

        queue.set(guildId, queueConstruct);
        queueConstruct.songs.push(song);

        try {
            await connectAndPlay(queueConstruct);
            console.log(`Connected and playing in guild ${message.guild.name}`);
        } catch (err) {
            console.error(`Failed to connect to voice channel in guild ${message.guild.name}: ${err}`);
            console.error(err);
            queue.delete(guildId);
            return message.channel.send('Error connecting to the voice channel.');
        }
    } else {
        serverQueue.songs.push(song);
        console.log(`Added song ${song.title} to the existing queue in guild ${message.guild.name}`);
        message.channel.send(`${song.title} has been added to the queue by ${song.requester}`);
        if (serverQueue.idle) {
            console.log(`Queue was idle, now playing ${song.title} in guild ${message.guild.name}`);
            playSong(guildId, serverQueue.songs[0]);
        }
    }
}

async function connectAndPlay(queueConstruct) {

    console.log(`Attempting to connect to voice channel in guild ${queueConstruct.voiceChannel.guild.name}`);

    if (!queueConstruct.connection || queueConstruct.connection.state.status !== 'connected') {
        try {
            const connection = joinVoiceChannel({
                channelId: queueConstruct.voiceChannel.id,
                guildId: queueConstruct.voiceChannel.guild.id,
                adapterCreator: queueConstruct.voiceChannel.guild.voiceAdapterCreator,
            });
            queueConstruct.connection = connection;

            console.log(`Successfully connected to voice channel in guild ${queueConstruct.voiceChannel.guild.name}`);

            connection.subscribe(queueConstruct.player);

            console.log(`Subscribed player to voice connection in guild ${queueConstruct.voiceChannel.guild.name}`);

            playSong(queueConstruct.voiceChannel.guild.id, queueConstruct.songs[0]);
        } catch (error) {

            console.error(`Failed to connect to voice channel in guild ${queueConstruct.voiceChannel.guild.name}: ${error}`);

            queue.delete(queueConstruct.voiceChannel.guild.id);
            queueConstruct.textChannel.send('Could not join the voice channel.');
        } 
    } else {
        console.log(`Already connected to voice channel in guild ${queueConstruct.voiceChannel.guild.name}`);
    }
}

async function playSong(guildId, song, startTime = 0) {
    const serverQueue = queue.get(guildId);

    console.log(`Starting playSong for guild ${guildId}: song = ${song ? song.title : 'None'}`);

    if (!song) {

        console.log(`No song provided to playSong in guild ${guildId}, passing to no song scenario.`);

        handleNoSong(serverQueue, guildId);
        return;
    }

    if (!serverQueue.connection || serverQueue.connection.state.status !== 'ready') {

        console.log(`Connection not ready in guild ${guildId}, attempting to connect.`);

        try {
            await connectAndPlay(serverQueue);

            console.log(`Connection established and ready in guild ${guildId}`);

        } catch (error) {

            console.error(`Error connecting to voice channel in guild ${guildId}: ${error}`);

            serverQueue.textChannel.send('Could not connect to the voice channel.');
            return;
        }
    }
    serverQueue.attempts = 0;

    console.log(`Attempts reset to 0 for guild ${guildId}.`);

    resetInactivityTimeout(serverQueue);

    console.log(`Inactivity timeout reset for guild ${guildId}.`);

    try {
        const resource = await setupAudioResource(song, startTime);

        console.log(`Audio resource setup complete for song ${song.title} in guild ${guildId}.`);

        serverQueue.player.play(resource);
        managePlayerListeners(serverQueue, guildId);

        console.log(`Song ${song.title} is now playing in guild ${guildId}.`);

    } catch (error) {

        console.error(`Failed to play song ${song.title} in guild ${guildId}: ${error}`);

        console.error(`Failed to play song ${song.title}: ${error}`);
        retryOrSkipSong(serverQueue, guildId, song);
    }
}

function handleNoSong(serverQueue, guildId) {
    console.log(`Handling no song scenario for guild ${guildId}.`);

    resetInactivityTimeout(serverQueue);

    
    serverQueue.timeoutHandle = setTimeout(() => {
        console.log(`Timeout reached with no activity in guild ${guildId}, initiating graceful disconnect.`);
        gracefulDisconnect(guildId);
    }, 300000);

    serverQueue.idle = true;
    console.log(`Marked queue as idle for guild ${guildId}.`);
}

function resetInactivityTimeout(serverQueue) {
    if (serverQueue.timeoutHandle) {
        console.log(`Clearing existing timeout for guild.`);
        clearTimeout(serverQueue.timeoutHandle);
        serverQueue.timeoutHandle = null;
    }
}
async function setupAudioResource(song, startTime) {
    const streamOptions = { seek: startTime, volume: 1, highWaterMark: 1 << 25 };
    const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
    });
    return resource;
}

function managePlayerListeners(serverQueue, guildId) {
    serverQueue.player.removeAllListeners(AudioPlayerStatus.Playing);
    serverQueue.player.on(AudioPlayerStatus.Playing, () => {
        serverQueue.lastPlayTimestamp = Date.now();
        serverQueue.idle = false;
    });

    serverQueue.player.removeAllListeners(AudioPlayerStatus.Idle);
    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
        handlePlayerIdle(serverQueue, guildId);
    });
}

function retryOrSkipSong(serverQueue, guildId, song) {

    console.log(`Retry or skip song triggered for song ${song.title} in guild ${guildId}. Current attempts: ${serverQueue.attempts}`);

    serverQueue.attempts++;

    console.log(`Incremented attempts for song ${song.title} in guild ${guildId}. Total attempts now: ${serverQueue.attempts}`);

    if (serverQueue.attempts < maxAttempts) {
        const elapsedTime = Date.now() - serverQueue.lastPlayTimestamp;

        console.log(`Attempting to replay song ${song.title} in guild ${guildId} after ${elapsedTime}ms of last play.`);

        playSong(guildId, song, elapsedTime);
    } else {

        console.log(`Max attempts reached for song ${song.title} in guild ${guildId}. Skipping song.`);

        serverQueue.textChannel.send(`Error playing ${song.title}. Skipping after ${maxAttempts} attempts.`);
        serverQueue.songs.shift();
        serverQueue.attempts = 0;
        if (serverQueue.songs.length > 0) {

            console.log(`Continuing to the next song in the queue for guild ${guildId}.`);

            playSong(guildId, serverQueue.songs[0]);
        } else {
            console.log(`No more songs left in the queue for guild ${guildId}.`);

            handleNoSong(serverQueue, guildId);
        }
    }
}

async function handlePauseCommand(message) {
    const guildId = message.guild.id;
    const serverQueue = queue.get(guildId);

    // Check if there is an active server queue and a player
    if (!serverQueue || !serverQueue.player) {
        return message.channel.send("There is no song currently playing.");
    }

    // Determine the current state of the player and toggle pause/resume
    if (serverQueue.player.state.status === AudioPlayerStatus.Playing) {
        serverQueue.player.pause();
        message.channel.send("Playback has been paused.");
        console.log(`Playback paused in guild ${guildId}`);
    } else if (serverQueue.player.state.status === AudioPlayerStatus.Paused) {
        serverQueue.player.unpause();
        message.channel.send("Playback has resumed.");
        console.log(`Playback resumed in guild ${guildId}`);
    } else {
        message.channel.send("No active song to pause or resume.");
    }
}

async function handleSkipCommand(message) {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue) {
        return message.channel.send("There is no song that I could skip!");
    }
    serverQueue.player.stop();
}
async function handleQueueCommand(message, args) {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue || serverQueue.songs.length === 0) {
        return message.channel.send("There are no songs in the queue!");
    }

    const page = parseInt(args[0]) || 1;
    const itemsPerPage = 10; // Number of songs per page
    const pages = Math.ceil(serverQueue.songs.length / itemsPerPage);
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;

    const songList = serverQueue.songs.slice(start, end).map((song, index) => `${start + index + 1}. ${song.title} (requested by ${song.requester})`).join('\n');
    message.channel.send(`**Song Queue - Page ${page}/${pages}:**\n${songList}`);
}
function gracefulDisconnect(guildId) {
    const serverQueue = queue.get(guildId);
    if (!serverQueue) {
        console.log(`No server queue found for guild ID: ${guildId}`);
        return;
    }

    // Inform the channel if needed
    serverQueue.textChannel.send('Disconnecting due to inactivity or by request.').catch(console.error);

    // Clear any set timeout for inactivity
    if (serverQueue.timeoutHandle) {
        clearTimeout(serverQueue.timeoutHandle);
        serverQueue.timeoutHandle = null;
    }

    // Stop the audio player
    if (serverQueue.player) {
        serverQueue.player.stop();
    }

    // Destroy the voice connection
    if (serverQueue.connection) {
        serverQueue.connection.destroy();
    }

    // Remove the guild's queue from the map
    queue.delete(guildId);

    console.log(`Gracefully disconnected from guild ID: ${guildId}`);
}
client.login(process.env.DISCORD_BOT_TOKEN);
