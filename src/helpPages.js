import { EmbedBuilder } from 'discord.js';

/**
 * Build paginated help embeds for Sass.
 * Used by both @Sass help and /help.
 */
export function buildHelpPages(botAvatar) {
  const pages = [
    // Page 1 — Overview
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass', iconURL: botAvatar })
      .setThumbnail(botAvatar)
      .setDescription("here's everything i can do. use it wisely (you won't).\n\n*i learn from every interaction. the more you talk, the more ammo i have.*")
      .addFields(
        { name: '💬 Chat', value: '`@Sass <anything>` — talk to me\n`/sass <message>` — same thing but fancier', inline: true },
        { name: '🧠 Memory', value: '`@Sass remember <fact>` — weaponize yourself\n`@Sass remember @user <fact>` — snitch on someone', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '⚠️ Fine Print', value: 'i jump into convos uninvited. tell me to stop and i\'ll ghost you until you beg.', inline: false },
      ),

    // Page 2 — Stats & Tracking
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass — Stats & Tracking', iconURL: botAvatar })
      .addFields(
        { name: '📊 Leaderboard', value: '`@Sass leaderboard`\nthe wall of shame. see who\'s been destroyed the most.', inline: true },
        { name: '🧬 Profile', value: '`@Sass profile [@user]`\nbehavioral diagnosis — chaos, clown, brain scores and archetype.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '⭐ Favorite', value: '`/favorite`\ni pick my favorite person. not you.', inline: true },
        { name: '🏆 Hall of Fame', value: '`/halloffame`\nthe wildest things people have said.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '🥩 Beef', value: '`/beef @user1 @user2`\ncheck the beef history between two people.', inline: true },
        { name: '🎭 Main Character', value: '`/maincharacter`\nwho\'s the protagonist today? spoiler: not you.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '📦 Wrapped', value: '`/wrapped`\nyour server\'s year in review. with my commentary.', inline: false },
      ),

    // Page 3 — Fun Commands
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass — Fun', iconURL: botAvatar })
      .addFields(
        { name: '🎱 8 Ball', value: '`/8ball <question>`\nask me anything. i\'ll answer and roast you for asking.', inline: true },
        { name: '💘 Ship', value: '`/ship @user1 @user2` or `@Sass ship @u1 @u2`\ncompatibility check. i\'m brutally honest.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '🔥 Hot Take', value: '`/hottake <topic>`\ni give my spiciest, most unhinged opinion.', inline: true },
        { name: '🥠 Fortune', value: '`/fortune`\na cursed fortune cookie. you\'ve been warned.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '💬 Quote', value: '`/quote`\nfake inspirational quote. sounds deep, means nothing.', inline: true },
        { name: '🤖 NPC', value: '`/npc @user`\nrate someone\'s NPC energy on a scale.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '🎭 Roast As', value: '`/roastas @user <persona>` or `@Sass roast @user as <persona>`\ngordon ramsay, shakespeare, disappointed mom, drill sergeant, therapist, david attenborough, anime villain, passive aggressive coworker', inline: false },
      ),

    // Page 4 — More Fun & Battle
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass — More Fun & Battle', iconURL: botAvatar })
      .addFields(
        { name: '🌐 Translate', value: '`/translate <text> <style>`\ntranslate anything into: corporate, gen z, caveman, pirate, noir, anime, medieval, or passive aggressive.', inline: false },
        { name: '♈ Horoscope', value: '`/horoscope <sign>`\nsassy star reading. astrology but mean.', inline: true },
        { name: '🕵️ Conspiracy', value: '`@Sass conspiracy @user`\nabsurd conspiracy theory about someone. unhinged.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '💐 Compliment', value: '`@Sass compliment @user`\nbackhanded compliment. sounds nice, stings later.', inline: true },
        { name: '👀 Status', value: '`/status @user`\nroast someone\'s Discord activity. playing genshin for 4 hours? i\'ll let everyone know.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '⚔️ Roast Battle', value: '`/roastbattle @user`\nPvP roast battle in a thread. 3 rounds. AI judged.\nwinner gets bragging rights, loser gets humiliated.', inline: false },
      ),
  ];

  // Add page numbers to footers
  pages.forEach((page, i) => {
    page.setFooter({ text: `page ${i + 1}/${pages.length} — i'm not a helper bot. i'm a problem.`, iconURL: botAvatar });
    page.setTimestamp();
  });

  return pages;
}
