import {
  EmbedBuilder,
  type Message,
  type ThreadChannel,
} from 'discord.js';
import { queryAI } from './ai.js';
import type { BattleState } from './types.js';

// --- Roast Battle State ---
export const activeBattles = new Map<string, BattleState>();
const BATTLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min max per battle
const TURN_TIMEOUT_MS = 2 * 60 * 1000; // 2 min per turn

const FORFEIT_MESSAGES = [
  "took too long. that's a forfeit. 0 points.",
  "silence isn't a roast strategy. 0 points.",
  "couldn't even come up with one line? embarrassing. 0.",
  "timed out. the roast wrote itself — you're the joke.",
  "two minutes and nothing? the cowardice is the real roast.",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

// Clean up abandoned battles every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, battle] of activeBattles) {
    if (now - (battle.startedAt ?? 0) > BATTLE_TIMEOUT_MS) {
      if (battle.timeout) clearTimeout(battle.timeout);
      if (battle.turnTimeout) clearTimeout(battle.turnTimeout);
      activeBattles.delete(id);
    }
  }
}, 5 * 60 * 1000);

/**
 * Start a per-turn timeout. If the current player doesn't respond in 2 min,
 * they forfeit the round with 0 points and the battle advances.
 */
function startTurnTimer(battleId: string, threadChannel: ThreadChannel): void {
  const battle = activeBattles.get(battleId);
  if (!battle) return;

  // Clear any existing turn timer
  if (battle.turnTimeout) clearTimeout(battle.turnTimeout);

  battle.turnTimeout = setTimeout(async () => {
    // Re-fetch battle — might have been resolved during timeout
    const currentBattle = activeBattles.get(battleId);
    if (!currentBattle || currentBattle.phase !== 'active' || !currentBattle.currentTurn) return;

    const forfeitId = currentBattle.currentTurn;
    const forfeitName = forfeitId === currentBattle.challenger.id
      ? currentBattle.challenger.displayName
      : currentBattle.opponent.displayName;

    // Give 0 for the forfeit
    const forfeitScores = currentBattle.scores[forfeitId];
    if (forfeitScores) forfeitScores.push(0);

    const msg = pickRandom(FORFEIT_MESSAGES);
    await threadChannel.send(`⏰ **${forfeitName}** ${msg}`).catch((err) => console.error('Forfeit message failed:', (err as Error).message));

    // Advance turn/round
    const otherId = forfeitId === currentBattle.challenger.id ? currentBattle.opponent.id : currentBattle.challenger.id;
    const otherName = forfeitId === currentBattle.challenger.id ? currentBattle.opponent.displayName : currentBattle.challenger.displayName;

    const otherScores = currentBattle.scores[otherId];
    if (otherScores && otherScores.length < currentBattle.round) {
      currentBattle.currentTurn = otherId;
      await threadChannel.send(`**${otherName}**, your turn. fire back.`).catch((err) => console.error('Turn message failed:', (err as Error).message));
      startTurnTimer(battleId, threadChannel);
    } else {
      currentBattle.round++;
      if (currentBattle.round > currentBattle.maxRounds) {
        await endBattle(battleId, currentBattle, threadChannel);
      } else {
        const roundEmbed = new EmbedBuilder()
          .setColor(0xFF4D6D)
          .setTitle(`⚔️ ROUND ${currentBattle.round}/${currentBattle.maxRounds}`)
          .setDescription(`**${currentBattle.challenger.displayName}**, you're up.`);
        currentBattle.currentTurn = currentBattle.challenger.id;
        await threadChannel.send({ embeds: [roundEmbed] }).catch((err) => console.error('Round embed failed:', (err as Error).message));
        startTurnTimer(battleId, threadChannel);
      }
    }
  }, TURN_TIMEOUT_MS);
}

/**
 * End a battle — show results, clean up, archive thread.
 */
async function endBattle(battleId: string, battle: BattleState, threadChannel: ThreadChannel): Promise<void> {
  const challengerScores = battle.scores[battle.challenger.id] ?? [];
  const opponentScores = battle.scores[battle.opponent.id] ?? [];
  const score1 = challengerScores.reduce((a, b) => a + b, 0);
  const score2 = opponentScores.reduce((a, b) => a + b, 0);
  const winner = score1 > score2 ? battle.challenger : score2 > score1 ? battle.opponent : null;
  const loser = winner ? (winner.id === battle.challenger.id ? battle.opponent : battle.challenger) : null;

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('⚔️ ROAST BATTLE — FINAL RESULTS')
    .addFields(
      { name: battle.challenger.displayName, value: `${challengerScores.join(' + ')} = **${score1}**`, inline: true },
      { name: 'vs', value: '⚔️', inline: true },
      { name: battle.opponent.displayName, value: `${opponentScores.join(' + ')} = **${score2}**`, inline: true },
      { name: '\u200b', value: '\u200b', inline: false },
      { name: '🏆 Winner', value: winner ? `**${winner.displayName}** absolutely cooked.` : "it's a tie. you're both equally mid.", inline: false },
    )
    .setFooter({ text: loser ? `${loser.displayName} needs to sit down for a while` : 'nobody won. everybody lost.' });

  await threadChannel.send({ embeds: [embed] }).catch((err) => console.error('Battle results failed:', (err as Error).message));
  if (battle.turnTimeout) clearTimeout(battle.turnTimeout);
  activeBattles.delete(battleId);
  setTimeout(() => threadChannel.setArchived(true).catch((err) => console.error('Failed to archive battle thread:', err.message)), 10000);
}

export async function handleBattleMessage(message: Message): Promise<boolean> {
  // Only handle messages in threads that are active battles
  const battle = activeBattles.get(message.channel.id);
  if (!battle) return false;
  const threadChannel = message.channel as ThreadChannel;

  // Ignore messages from non-participants
  if (message.author.id !== battle.challenger.id && message.author.id !== battle.opponent.id) return false;

  // Check if someone is accepting a battle
  if (message.content.toLowerCase() === 'accept' && battle.phase === 'waiting' && message.author.id === battle.opponent.id) {
    if (battle.timeout) clearTimeout(battle.timeout);
    battle.phase = 'active';
    battle.round = 1;
    battle.currentTurn = battle.challenger.id;

    const roundEmbed = new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setTitle('⚔️ ROUND 1/3')
      .setDescription(`**${battle.challenger.displayName}**, you challenged — you go first.\n\ndrop your best roast.`);
    await threadChannel.send({ embeds: [roundEmbed] });
    startTurnTimer(message.channel.id, threadChannel);
    return true;
  }

  // Check if this is a roast in an active battle
  if (battle.phase === 'active' && message.author.id === battle.currentTurn) {
    const battleId = message.channel.id;

    // Clear the turn timer — they responded in time
    if (battle.turnTimeout) clearTimeout(battle.turnTimeout);

    // Score the roast — fallback to mercy score if AI fails
    let score = 5;
    let reaction: string;
    try {
      const scoreResponse = await queryAI(
        `You are judging a roast battle. Score this roast from 1-10 and give a one-sentence reaction.\n\nRoast: "${message.content}"\n\nRespond in EXACTLY this format:\nSCORE:N\nREACTION:your reaction`,
        { systemPrompt: 'You judge roast battles. Be fair but entertaining. Score genuinely — a weak roast gets a 3-4, a decent one 5-7, a banger 8-10. One sentence reaction.' }
      );

      const scoreLine = scoreResponse?.match(/SCORE:(\d+)/);
      const reactionLine = scoreResponse?.match(/REACTION:(.+)/);
      score = scoreLine?.[1] ? Math.min(10, Math.max(1, parseInt(scoreLine[1], 10))) : 5;
      reaction = reactionLine?.[1] ? reactionLine[1].trim() : "interesting.";
    } catch (err) {
      console.error('Battle judging failed:', (err as Error).message);
      reaction = "my judging brain broke. mercy score.";
    }

    const authorScores = battle.scores[message.author.id];
    if (authorScores) authorScores.push(score);

    const scoreBar = '🔥'.repeat(score) + '💨'.repeat(10 - score);
    await message.reply(`${scoreBar} **${score}/10**\n*${reaction}*`);

    // Switch turns or advance round — always runs even if scoring fell back
    const otherId = message.author.id === battle.challenger.id ? battle.opponent.id : battle.challenger.id;
    const otherName = message.author.id === battle.challenger.id ? battle.opponent.displayName : battle.challenger.displayName;

    const otherScores = battle.scores[otherId];
    if (otherScores && otherScores.length < battle.round) {
      battle.currentTurn = otherId;
      await threadChannel.send(`**${otherName}**, your turn. fire back.`);
      startTurnTimer(battleId, threadChannel);
    } else {
      battle.round++;
      if (battle.round > battle.maxRounds) {
        await endBattle(battleId, battle, threadChannel);
      } else {
        const roundEmbed = new EmbedBuilder()
          .setColor(0xFF4D6D)
          .setTitle(`⚔️ ROUND ${battle.round}/${battle.maxRounds}`)
          .setDescription(`**${battle.challenger.displayName}**, you're up.`);
        battle.currentTurn = battle.challenger.id;
        await threadChannel.send({ embeds: [roundEmbed] });
        startTurnTimer(battleId, threadChannel);
      }
    }
    return true;
  }

  return false;
}
