import { DISCORD_TOKEN } from './config/secret'
import express, { Request, Response } from 'express'
import Discord, {
	Interaction,
	GuildMember,
	Snowflake,
	MessageEmbed,
} from 'discord.js'
import {
	AudioPlayerStatus,
	AudioResource,
	entersState,
	joinVoiceChannel,
	VoiceConnectionStatus,
} from '@discordjs/voice'
import { Track } from './music/track'
import { MusicSubscription } from './music/subscription'
import { searchVideo } from './lib/search'

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
// const { token } = require('../auth.json')

const client = new Discord.Client({
	intents: ['GUILD_VOICE_STATES', 'GUILD_MESSAGES', 'GUILDS'],
})

const port = process.env.PORT || 3300
const app = express()

app.use(express.urlencoded({ extended: true }))

app.use('/', (request: Request, response: Response) => {
	response.sendStatus(200)
})

client.on('ready', () => {
	client.user?.setActivity({
		name: 'Siska Leontyne',
		url: 'https://www.youtube.com/channel/UC5qSx7KzdRwbsO1QmJc4d-w',
		type: 'WATCHING',
	})
	return console.log('Ready!')
})

// This contains the setup code for creating slash commands in a guild. The owner of the bot can send "!deploy" to create them.
client.on('messageCreate', async (message) => {
	if (!message.guild) return
	if (!client.application?.owner) await client.application?.fetch()

	if (
		message.content.toLowerCase() === '!deploy' &&
		message.author.id === client.application?.owner?.id
	) {
		await message.guild.commands.set([
			{
				name: 'p',
				description: 'Muter lagu, tapi P',
				options: [
					{
						name: 'song',
						type: 'STRING' as const,
						description: 'Judul terserah. hasil terserah',
						required: true,
					},
				],
			},
			{
				name: 'j',
				description: 'Skip skip',
				options: [
					{
						name: 'urutan',
						type: 'INTEGER' as const,
						description: 'Lagune ndk setlist nomer piro?',
						required: true,
					},
				],
			},
			{
				name: 'skip',
				description: 'Skip to the next song in the queue',
			},
			{
				name: 'q',
				description: 'Queue dibaca Kiu, bukan Ku Ewe',
			},
			{
				name: 'pause',
				description: 'Pauses the song that is currently playing',
			},
			{
				name: 'resume',
				description: 'Resume playback of the current song',
			},
			{
				name: 'dc',
				description: 'Leave the voice channel',
			},
			{
				name: 'misuh',
				description: 'Misuhi sing kok tag.',
				options: [
					{
						name: 'gawe',
						type: 'STRING' as const,
						description: 'Sopo sing kate kok pishui?',
						required: true,
					},
				],
			},
			{
				name: 'help',
				description: 'Punten.',
			},
		])

		await message.reply('Deployed!')
	}
})

/**
 * Maps guild IDs to music subscriptions, which exist if the bot has an active VoiceConnection to the guild.
 */
const subscriptions = new Map<Snowflake, MusicSubscription>()

// Handles slash command interactions
client.on('interactionCreate', async (interaction: Interaction) => {
	if (!interaction.isCommand() || !interaction.guildId) return
	let subscription = subscriptions.get(interaction.guildId)

	if (interaction.commandName === 'p') {
		await interaction.deferReply()
		// Extract the video URL from the command

		let url = interaction.options.get('song')!.value! as string

		if (url.includes('https://')) {
			url = url
		} else {
			const videos = await searchVideo(url)
			// console.log(videos);

			url = videos[0].url
		}

		// If a connection to the guild doesn't already exist and the user is in a voice channel, join that channel
		// and create a subscription.
		if (!subscription) {
			if (
				interaction.member instanceof GuildMember &&
				interaction.member.voice.channel
			) {
				const channel = interaction.member.voice.channel
				subscription = new MusicSubscription(
					joinVoiceChannel({
						channelId: channel.id,
						guildId: channel.guild.id,
						adapterCreator: channel.guild.voiceAdapterCreator,
					}),
				)
				subscription.voiceConnection.on('error', console.warn)
				subscriptions.set(interaction.guildId, subscription)
			}
		}

		// If there is no subscription, tell the user they need to join a channel.
		if (!subscription) {
			await interaction.followUp(
				'Join a voice channel and then try that again!',
			)
			return
		}

		// Make sure the connection is ready before processing the user's request
		try {
			await entersState(
				subscription.voiceConnection,
				VoiceConnectionStatus.Ready,
				20e3,
			)
		} catch (error) {
			console.warn(error)
			await interaction.followUp(
				'Failed to join voice channel within 20 seconds, please try again later!',
			)
			return
		}

		try {
			// Attempt to create a Track from the user's video URL
			const track = await Track.from(url, {
				onStart() {
					// interaction.user.send('Now playing!')
					// interaction.followUp({ content: 'Now playing!', ephemeral: true }).catch(console.warn);
				},
				onFinish() {
					// interaction.followUp({ content: 'Now finished!', ephemeral: true }).catch(console.warn);
				},
				onError(error) {
					console.warn(error)
					interaction
						.followUp({ content: `Error: ${error.message}`, ephemeral: true })
						.catch(console.warn)
				},
			})
			// Enqueue the track and reply a success message to the user
			subscription.enqueue(track)
			const embed = new MessageEmbed()
				.setTitle('Playing')
				.setColor('PURPLE')
				.addFields([{ name: 'Enqueued', value: `${track.title}` }])

			await interaction.followUp({ embeds: [embed] })
		} catch (error) {
			console.warn(error)
			await interaction.reply('Failed to play track, please try again later!')
		}
	} else if (interaction.commandName === 'j') {
		await interaction.deferReply()

		let urutan = interaction.options.get('urutan')?.value as number
		if (subscription) {
			// Calling .stop() on an AudioPlayer causes it to transition into the Idle state. Because of a state transition
			// listener defined in music/subscription.ts, transitions into the Idle state mean the next track from the queue
			// will be loaded and played.

			const queue = subscription.queue
			if (urutan > queue.length + 1 || urutan < 0) {
				await interaction.editReply('Array IndexOutOfBoundException Blok.')
				return
			}

			try {
				let nextTrack = queue[urutan - 1]

				const resource = await nextTrack.createAudioResource()
				subscription.audioPlayer.play(resource)

				await interaction.editReply(`Skip skip ke ${nextTrack.title}`)
				return
			} catch (error) {
				await interaction.editReply('Array IndexOutOfBoundException Blok.')
				return
			}
		} else {
			await interaction.editReply('Not playing in this server!')
		}
	} else if (interaction.commandName === 'skip') {
		if (subscription) {
			// Calling .stop() on an AudioPlayer causes it to transition into the Idle state. Because of a state transition
			// listener defined in music/subscription.ts, transitions into the Idle state mean the next track from the queue
			// will be loaded and played.
			subscription.audioPlayer.stop()
			await interaction.reply('Skipped song!')
		} else {
			await interaction.reply('Not playing in this server!')
		}
	} else if (interaction.commandName === 'q') {
		// Print out the current queue, including up to the next 5 tracks to be played.
		if (subscription) {
			const current =
				subscription.audioPlayer.state.status === AudioPlayerStatus.Idle
					? `Nothing is currently playing!`
					: `Now Playing **${
							(subscription.audioPlayer.state.resource as AudioResource<Track>)
								.metadata.title
					  }**`

			const queue = subscription.queue
				.slice(0, 5)
				.map((track, index) => `${index + 1}. ${track.title}`)
				.join('\n')

			await interaction.reply(
				` > ${current} \n ${'``` Setlist: \n'}${queue}${'\n```'}`,
			)
		} else {
			await interaction.reply('Not playing in this server!')
		}
	} else if (interaction.commandName === 'pause') {
		if (subscription) {
			subscription.audioPlayer.pause()
			await interaction.reply({ content: `Paused!`, ephemeral: true })
		} else {
			await interaction.reply('Not playing in this server!')
		}
	} else if (interaction.commandName === 'resume') {
		if (subscription) {
			subscription.audioPlayer.unpause()
			await interaction.reply({ content: `Unpaused!`, ephemeral: true })
		} else {
			await interaction.reply('Not playing in this server!')
		}
	} else if (interaction.commandName === 'dc') {
		if (subscription) {
			subscription.voiceConnection.destroy()
			subscriptions.delete(interaction.guildId)
			await interaction.reply({ content: `Left channel!`, ephemeral: true })
		} else {
			await interaction.reply('Not playing in this server!')
		}
	} else if (interaction.commandName === 'misuh') {
		await interaction.deferReply()

		let tagged = interaction.options.get('gawe')?.value! as string

		try {
			let pisuhan = ['jancok', 'asu', 'kontol']
			const random = Math.floor(Math.random() * pisuhan.length)

			await interaction.editReply(`${tagged} ${pisuhan[random].toUpperCase()}!`)
		} catch (error) {
			await interaction.editReply(error as string)
		}
	} else if (interaction.commandName === 'help') {
		const embed = new MessageEmbed()
			.setTitle('Groovy Bootleg Commands')
			.setColor('PURPLE')
			.setThumbnail(
				'https://yt3.ggpht.com/ytc/AKedOLTZlSN-xKAvHVnVfQjn_y1q6XYJADmcERl9s4Qn=s88-c-k-c0x00ffffff-no-rj',
			)
			.addFields([
				{ name: '/p', value: 'Muter lagu, tapi P' },
				{ name: '/q', value: 'Qiu' },
				{ name: '/j', value: 'Skip skip' },
				{ name: '/skip', value: 'Skip' },
				{ name: '/pause', value: 'Pause' },
				{ name: '/resume', value: 'Resume' },
				{ name: '/dc', value: 'Disconnect' },
			])
		await interaction.reply({ embeds: [embed] })
	} else {
		await interaction.reply('Unknown command')
	}
})

client.on('error', console.warn)

void client.login(DISCORD_TOKEN)
app.listen(port, () => console.log(`Server started on port ${port}!`))
