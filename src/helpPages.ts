import { EmbedBuilder } from 'discord.js';

/**
 * Build paginated help embeds for Sass.
 * Used by both @Sass help and /help.
 */
export function buildHelpPages(botAvatar: string | null | undefined): EmbedBuilder[] {
  const pages = [
    // Page 1 — Overview
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass', iconURL: botAvatar ?? undefined })
      .setThumbnail(botAvatar ?? null)
      .setDescription("here's everything i can do. use it wisely (you won't).\n\n*i learn from every interaction. the more you talk, the more ammo i have.*")
      .addFields(
        { name: '\u{1F4AC} Chat', value: '`@Sass <anything>` \u2014 talk to me\njust say "sass" and i\'ll hear you too', inline: true },
        { name: '\u{1F9E0} Memory', value: '`@Sass remember <fact>` \u2014 weaponize yourself\n`@Sass remember @user <fact>` \u2014 snitch on someone', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F321}\uFE0F Mood', value: '`@Sass mood`\nmy vibe shifts based on how you treat me.', inline: true },
        { name: '\u26A0\uFE0F Fine Print', value: 'i jump into convos uninvited. tell me to stop and i\'ll ghost you.', inline: true },
      ),

    // Page 2 — Stats & Tracking
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 Stats & Tracking', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u{1F4CA} Leaderboard', value: '`@Sass leaderboard`\nwall of shame. most roasted users.', inline: true },
        { name: '\u{1F9EC} Profile', value: '`@Sass profile [@user]`\nbehavioral diagnosis + archetype.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u2B50 Favorite', value: '`/favorite`\ni pick my favorite person. not you.', inline: true },
        { name: '\u{1F3C6} Hall of Fame', value: '`/halloffame`\nwildest things said in this server.', inline: true },
      ),

    // Page 3 — Fun Commands
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 Fun', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u{1F498} Ship', value: '`/ship @u1 @u2`\ncompatibility %. grows with interactions. 100% is earned.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F525} Hot Take', value: '`/hottake <topic>`\nmy spiciest, most unhinged opinion.', inline: true },
        { name: '\u{1F960} Fortune', value: '`/fortune`\ncursed fortune cookie. you\'ve been warned.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F4AC} Quote', value: '`/quote`\nfake inspirational quote. means nothing.', inline: true },
      ),

    // Page 4 — More Fun
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 More Fun', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u2648 Horoscope', value: '`/horoscope <sign>`\nastrology but mean. once per day.', inline: true },
        { name: '\u{1F575}\uFE0F Conspiracy', value: '`/conspiracy @user`\nabsurd theory using real intel.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F490} Compliment', value: '`@Sass compliment @user`\nbackhanded. sounds nice, stings later.', inline: true },
        { name: '\u{1F440} Status', value: '`/status @user`\nroast someone\'s Discord activity.', inline: true },
      ),

    // Page 5 — Battle & Daily
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 Battle & Daily', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u2694\uFE0F Roast Battle', value: '`/roastbattle @user`\nPvP in a thread. 3 rounds. AI judged. 2 min per turn or forfeit.', inline: false },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F3B2} Dare', value: '`/dare @user`\nunhinged dare. once per day.', inline: true },
        { name: '\u{1F64A} Confess', value: '`/confess @user <text>`\nanonymous confession. once per day.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F52E} Predict', value: '`/predict @user`\nfuture prediction. never good. once per day.', inline: true },
        { name: '\u{1F969} Beef', value: '`/beef @u1 @u2`\ncheck beef history between two people.', inline: true },
      ),
  ];

  // Add page numbers to footers
  pages.forEach((page, i) => {
    page.setFooter({ text: `page ${i + 1}/${pages.length} \u2014 i'm not a helper bot. i'm a problem.`, iconURL: botAvatar ?? undefined });
    page.setTimestamp();
  });

  return pages;
}
