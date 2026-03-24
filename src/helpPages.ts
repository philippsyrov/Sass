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
        { name: '\u26A0\uFE0F Fine Print', value: 'i jump into convos uninvited. my mood shifts based on how you treat me.', inline: true },
      ),

    // Page 2 — Stats & Tracking
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 Stats & Tracking', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u{1F4CA} Leaderboard', value: '`/leaderboard`\nwall of shame. most roasted users.', inline: true },
        { name: '\u{1F9EC} Profile', value: '`/profile [@user]`\nbehavioral diagnosis + archetype.', inline: true },
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
        { name: '\u{1F490} Compliment', value: '`/compliment @user`\nbackhanded. sounds nice, stings later.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F440} Status', value: '`/status @user`\nroast someone\'s Discord activity.', inline: true },
      ),

    // Page 5 — Battle & Beef
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 Battle & Beef', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u2694\uFE0F Roast Battle', value: '`/roastbattle @user`\nPvP in a thread. 3 rounds. AI judged. 2 min per turn or forfeit.', inline: false },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F969} Beef', value: '`/beef @u1 @u2`\ncheck beef history between two people.', inline: true },
        { name: '\u{1F3C6} Best Of', value: '`/bestof`\nmy greatest hits, ranked by your reactions.', inline: true },
      ),

    // Page 6 — Affinity & Ship Guide
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 How Ship Works', iconURL: botAvatar ?? undefined })
      .setDescription("relationships are earned, not given. here's how it works.")
      .addFields(
        { name: '\u{1F498} You x Sass', value: '`@Sass` talk to me \u2014 **+0.5** (10min cooldown)\nreact \u{1F44D} to my messages \u2014 **+0.25**\ninsult me \u2014 **-5**\nspam me \u2014 **-3**\nnegative react \u2014 **-2**', inline: false },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F465} User x User', value: 'reply to each other \u2014 **+0.5** per reply\nbeef (hostile @mention/reply) \u2014 **-3**', inline: false },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u23F1\uFE0F Time to 100%', value: '50\u219260% \u2014 ~3 days (full gains)\n60\u219275% \u2014 ~9 days (half speed)\n75\u219290% \u2014 ~17 days (quarter speed)\n90\u2192100% \u2014 ~29 days (grind mode)\n**total: ~2 months of dedication**', inline: true },
        { name: '\u{1F4C9} Decay', value: "don't talk to me for 3 days?\n**-1/day** until you come back.\nfloor: 30% (i won't forget you entirely).", inline: true },
      ),
  ];

  // Add page numbers to footers
  pages.forEach((page, i) => {
    page.setFooter({ text: `page ${i + 1}/${pages.length} \u2014 i'm not a helper bot. i'm a problem.`, iconURL: botAvatar ?? undefined });
    page.setTimestamp();
  });

  return pages;
}
