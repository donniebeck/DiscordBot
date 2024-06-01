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

let songCounter = 0;

async function playSong(guildId, song, startTime = 0) {
    const serverQueue = queue.get(guildId);
    if (!song) {
        // Set a timeout to leave the channel after 5 minutes of inactivity
        if (serverQueue.timeoutHandle) {
            clearTimeout(serverQueue.timeoutHandle); // Clear existing timeout if it exists
        }
        serverQueue.timeoutHandle = setTimeout(() => {
            serverQueue.connection.destroy();
            queue.delete(guildId);
            console.log("Left the channel due to inactivity.");
        }, 300000); // 300000 ms = 5 minutes
        serverQueue.idle = true;
        return;
    }

    // Clear inactivity timeout if a song is about to play
    if (serverQueue.timeoutHandle) {
        clearTimeout(serverQueue.timeoutHandle);
        serverQueue.timeoutHandle = null;
    }

    let attempts = 0;
    const maxAttempts = 3; // Maximum number of retry attempts

    const playResource = async () => {
        try {
            const streamOptions = { seek: startTime, volume: 1, highWaterMark: 1 << 25 };
            const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
            const resource = createAudioResource(stream, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true,
            });
            serverQueue.player.play(resource);

            // Send message for playing song if it's not a quip
            if (!song.isQuip) {
                serverQueue.textChannel.send(`Now playing: ${song.title}`);
            }

            // Manage event listeners
            serverQueue.player.removeAllListeners(AudioPlayerStatus.Playing);
            serverQueue.player.on(AudioPlayerStatus.Playing, () => {
                serverQueue.lastPlayTimestamp = Date.now();
                serverQueue.idle = false; // Player is not idle
            });

            serverQueue.player.removeAllListeners(AudioPlayerStatus.Idle);
            serverQueue.player.on(AudioPlayerStatus.Idle, () => {
                serverQueue.idle = true; // Player is idle
                songCounter++;
                if (songCounter >= 3) {
                    songCounter = 0;
                    const randomVideoUrl = quips[Math.floor(Math.random() * quips.length)];
                    serverQueue.songs.splice(1, 0, { url: randomVideoUrl, title: 'quip', isQuip: true });
                }
                serverQueue.songs.shift();
                if (serverQueue.songs.length > 0) {
                    playSong(guildId, serverQueue.songs[0]);
                }
            });

            // Handle stream errors
            stream.on('error', error => {
                console.error(`Stream error for ${song.title}: ${error}`);
                attempts++;
                if (attempts < maxAttempts) {
                    const elapsedTime = Date.now() - serverQueue.lastPlayTimestamp;
                    playSong(guildId, song, elapsedTime);
                } else {
                    serverQueue.textChannel.send(`Error playing ${song.title}. Skipping after ${maxAttempts} attempts.`);
                    serverQueue.songs.shift();
                    if (serverQueue.songs.length > 0) {
                        playSong(guildId, serverQueue.songs[0]);
                    }
                }
            });

        } catch (error) {
            console.error(`Failed to play song ${song.title}: ${error}`);
            attempts++;
            if (attempts >= maxAttempts) {
                serverQueue.textChannel.send(`Failed to play ${song.title} after ${maxAttempts} attempts. Skipping to next song.`);
                serverQueue.songs.shift();
                if (serverQueue.songs.length > 0) {
                    playSong(guildId, serverQueue.songs[0]);
                }
            }
        }
    };


    playResource();
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

const queueLock = new Map();

async function withQueueLock(guildId, fn) {
    if (queueLock.has(guildId)) {
        await queueLock.get(guildId);
    }
    const lock = fn().finally(() => queueLock.delete(guildId));
    queueLock.set(guildId, lock);
    return lock;
}

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.bot) return;

    const args = message.content.slice(1).split(' ');
    const command = args.shift().toLowerCase();
    
    await withQueueLock(message.guild.id, async () => {
        if (command === 'play') {
            await handlePlayCommand(message, args);
        } else if (command === 'skip') {
            await handleSkipCommand(message);
        } else if (command === 'queue') {
            await handleQueueCommand(message, args);
        }
    });
});


async function handlePlayCommand(message, args) {
    const guildId = message.guild.id;
    const serverQueue = queue.get(message.guild.id);

    const songInfo = await ytdl.getInfo(args[0]);
    const song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        requester: message.author.username,
    };

    if (!serverQueue) {
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
        } catch (err) {
            console.error(err);
            queue.delete(guildId);
            return message.channel.send('Error connecting to the voice channel.');
        }
    } else {
        serverQueue.songs.push(song);
        message.channel.send(`${song.title} has been added to the queue by ${song.requester}`);
        if (serverQueue.idle) {
            playSong(guildId, serverQueue.songs[0]);
        }
    }
}

async function connectAndPlay(queueConstruct) {
    try {
        const connection = joinVoiceChannel({
            channelId: queueConstruct.voiceChannel.id,
            guildId: queueConstruct.voiceChannel.guild.id,
            adapterCreator: queueConstruct.voiceChannel.guild.voiceAdapterCreator,
        });
        queueConstruct.connection = connection;
        connection.subscribe(queueConstruct.player);
        playSong(queueConstruct.voiceChannel.guild.id, queueConstruct.songs[0]);
    } catch (error) {
        console.error(error);
        queue.delete(queueConstruct.voiceChannel.guild.id);
        queueConstruct.textChannel.send('Could not join the voice channel.');
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

client.login(process.env.DISCORD_BOT_TOKEN);
