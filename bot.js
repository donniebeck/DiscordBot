const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');
const isUrl = require('is-url');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

const queue = new Map();
const INACTIVITY_TIMEOUT = 300000; // 5 minutes

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.bot) return;
    const args = message.content.slice(1).split(' ');
    const command = args.shift().toLowerCase();
    if (command === 'play') {
        await handlePlayCommand(message, args);
    } else if (command === 'pause') {
        await handlePauseCommand(message);
    } else if (command === 'skip') {
        await handleSkipCommand(message);
    } else if (command === 'queue') {
        await handleQueueCommand(message, args);
    } else if (command === 'clear') {
        handleClearCommand(message);
    } else if (command === 'disconnect') {
        handleDisconnectCommand(message);
    }
});

async function connectToVoiceChannel(message) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        message.reply('You need to be in a voice channel to play music!');
        throw new Error('No voice channel');
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
        message.reply('I need the permissions to join and speak in your voice channel!');
        throw new Error('Insufficient permissions');
    }

    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        return connection;
    } catch (err) {
        console.log(err);
        message.reply('There was an error connecting to the voice channel!');
        throw err;
    }
}

function initializeQueue(guildId, textChannel, voiceChannel, connection) {
    const queueConstruct = {
        textChannel: textChannel,
        voiceChannel: voiceChannel,
        connection: connection,
        songs: [],
        player: createAudioPlayer(),
        timeout: null,
    };

    queue.set(guildId, queueConstruct);
    return queueConstruct;
}

function addToQueue(queueConstruct, song) {
    queueConstruct.songs.push(song);
}

function resetTimeout(queueConstruct) {
    if (queueConstruct.timeout) {
        clearTimeout(queueConstruct.timeout);
        queueConstruct.timeout = null;
    }
}

function setIdleTimeout(queueConstruct, guildId) {
    queueConstruct.timeout = setTimeout(() => {
        queueConstruct.connection.disconnect();
        queue.delete(guildId);
    }, INACTIVITY_TIMEOUT);
}

function isPlaylist(url) {
    const playlistRegex = /[?&]list=([^#&?]*)/;
    return playlistRegex.test(url);
}

async function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!serverQueue) {
        return;
    }

    resetTimeout(serverQueue);

    if (!song) {
        setIdleTimeout(serverQueue, guild.id);
        return;
    }

    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
    });

    serverQueue.player.play(resource);
    serverQueue.connection.subscribe(serverQueue.player);

    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
        serverQueue.songs.shift();
        playSong(guild, serverQueue.songs[0]);
    });

    serverQueue.textChannel.send(`Now playing: **${song.title}**`);
}

async function handlePlayCommand(message, args) {
    let connection;
    try {
        connection = await connectToVoiceChannel(message);
    } catch (error) {
        console.error('Error connecting to voice channel:', error);
        return;
    }

    const serverQueue = queue.get(message.guild.id);

    let songs = [];
    let isPlaylistUrl = false;
    // Check if the provided argument is a URL
    if (isUrl(args[0])) {
        try {
            if (isPlaylist(args[0])) {
                isPlaylistUrl = true;
                const playlistInfo = await play.playlist_info(args[0], { incomplete: true });
                const playlistVideos = await playlistInfo.all_videos();
                songs = playlistVideos.map(video => ({
                    title: video.title,
                    url: video.url
                }));
            } else {
                const songInfo = await play.video_info(args[0]);
                if (!songInfo || !songInfo.video_details) {
                    return message.reply('No video found for the provided URL.');
                }
               // console.log('Video Info:', songInfo);

                songs.push({
                    title: songInfo.video_details.title,
                    url: songInfo.video_details.url
                });
            }
        } catch (error) {
            console.error('Error fetching video info:', error);
            return message.reply('There was an error fetching the video info from the provided URL.');
        }
    } else {
        try {
            const searchResults = await play.search(args.join(' '), { limit: 1 });
            if (!searchResults.length) {
                return message.reply('No results found for your query.');
            }
            const songInfo = searchResults[0];
           // console.log('Search Results:', songInfo);

            songs.push({
                title: songInfo.title,
                url: songInfo.url
            });
        } catch (error) {
            console.error('Error searching for video:', error);
            return message.reply('There was an error searching for the video.');
        }
    }

  //  console.log('Songs:', songs);

    let queueConstruct;
    if (!serverQueue) {
        queueConstruct = initializeQueue(message.guild.id, message.channel, message.member.voice.channel, connection);
        for (const song of songs) {
            addToQueue(queueConstruct, song);
        }
        playSong(message.guild, queueConstruct.songs[0]);
    } else {
        for (const song of songs) {
            addToQueue(serverQueue, song);
        }
    }

    if (isPlaylistUrl) {
        message.channel.send(`${songs.length} songs from the playlist have been added to the queue!`);
    } else {
        message.channel.send(`${songs[0].title} has been added to the queue!`);
    }
}

async function handlePauseCommand(message) {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue) {
        return message.reply('There is no song currently playing.');
    }

    if (serverQueue.player.state.status === AudioPlayerStatus.Playing) {
        serverQueue.player.pause();
        message.channel.send('Playback has been paused.');
    } else if (serverQueue.player.state.status === AudioPlayerStatus.Paused) {
        serverQueue.player.unpause();
        message.channel.send('Playback has been resumed.');
    } else {
        message.reply('There is no song currently playing.');
    }
}

async function handleSkipCommand(message) {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue) {
        return message.reply('There is no song that I could skip!');
    }

    serverQueue.player.stop();
    message.channel.send('Song has been skipped!');
}

async function handleQueueCommand(message, args) {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue || serverQueue.songs.length === 0) {
        return message.reply('The queue is empty.');
    }

    const pageNumber = args.length ? parseInt(args[0], 10) : 1;
    const pageSize = 10;
    const totalPages = Math.ceil(serverQueue.songs.length / pageSize);

    if (isNaN(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
        return message.reply(`Invalid page number. Please provide a number between 1 and ${totalPages}.`);
    }

    const startIndex = (pageNumber - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, serverQueue.songs.length);

    const queuePage = serverQueue.songs.slice(startIndex, endIndex)
        .map((song, index) => `${startIndex + index + 1}. **${song.title}**`)
        .join('\n');

    const queueMessage = `**Queue - Page ${pageNumber}/${totalPages}**\n${queuePage}`;

    message.channel.send(queueMessage);
}

function handleDisconnectCommand(message) {
    const serverQueue = queue.get(message.guild.id);

    // Stop the player and disconnect the voice connection
    serverQueue.player.stop();
    serverQueue.connection.disconnect();

    // Clear the inactivity timeout if it is set
    if (serverQueue.timeout) {
        clearTimeout(serverQueue.timeout);
    }

    // Remove the server queue from the queue map
    queue.delete(message.guild.id);

    message.channel.send('Disconnected from the voice channel and cleaned up the queue.');
}

function handleClearCommand(message) {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue) {
        return message.reply('There is no queue to clear.');
    }

    // Stop the player
    serverQueue.player.stop();

    // Clear the song list
    serverQueue.songs = [];

    message.channel.send('The queue has been cleared.');
}


client.login(process.env.DISCORD_BOT_TOKEN);
