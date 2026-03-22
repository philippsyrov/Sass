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
        { name: '\u{1F4AC} Chat', value: '`@Sass <anything>` \u2014 talk to me\n`/sass <message>` \u2014 same thing but fancier', inline: true },
        { name: '\u{1F9E0} Memory', value: '`@Sass remember <fact>` \u2014 weaponize yourself\n`@Sass remember @user <fact>` \u2014 snitch on someone', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u26A0\uFE0F Fine Print', value: 'i jump into convos uninvited. tell me to stop and i\'ll ghost you until you beg.', inline: false },
      ),

    // Page 2 — Stats & Tracking
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 Stats & Tracking', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u{1F4CA} Leaderboard', value: '`@Sass leaderboard`\nthe wall of shame. see who\'s been destroyed the most.', inline: true },
        { name: '\u{1F9EC} Profile', value: '`@Sass profile [@user]`\nbehavioral diagnosis \u2014 chaos, clown, brain scores and archetype.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u2B50 Favorite', value: '`/favorite`\ni pick my favorite person. not you.', inline: true },
        { name: '\u{1F3C6} Hall of Fame', value: '`/halloffame`\nthe wildest things people have said.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F969} Beef', value: '`/beef @user1 @user2`\ncheck the beef history between two people.', inline: true },
        { name: '\u{1F3AD} Main Character', value: '`/maincharacter`\nwho\'s the protagonist today? spoiler: not you.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F4E6} Wrapped', value: '`/wrapped`\nyour server\'s year in review. with my commentary.', inline: true },
        { name: '\u{1F321}\uFE0F Mood', value: '`@Sass mood`\ncheck my current vibe. it shifts based on how you treat me.', inline: true },
      ),

    // Page 3 — Fun Commands
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 Fun', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u{1F3B1} 8 Ball', value: '`/8ball <question>`\nask me anything. i\'ll answer and roast you for asking.', inline: true },
        { name: '\u{1F498} Ship', value: '`/ship @user1 @user2` or `@Sass ship @u1 @u2`\ncompatibility check. scores are consistent \u2014 same pair, same %. your score grows the more you interact (replies, reactions). beefs lower it. 100% is earned, not given.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F525} Hot Take', value: '`/hottake <topic>`\ni give my spiciest, most unhinged opinion.', inline: true },
        { name: '\u{1F960} Fortune', value: '`/fortune`\na cursed fortune cookie. you\'ve been warned.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F4AC} Quote', value: '`/quote`\nfake inspirational quote. sounds deep, means nothing.', inline: true },
        { name: '\u{1F916} NPC', value: '`/npc @user`\nrate someone\'s NPC energy on a scale.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F3AD} Roast As', value: '`/roastas @user <persona>` or `@Sass roast @user as <persona>`\ngordon ramsay, shakespeare, disappointed mom, drill sergeant, therapist, david attenborough, anime villain, passive aggressive coworker', inline: false },
      ),

    // Page 4 — More Fun
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 More Fun', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u{1F310} Translate', value: '`/translate <text> <style>`\ntranslate anything into: corporate, gen z, caveman, pirate, noir, anime, medieval, or passive aggressive.', inline: false },
        { name: '\u2648 Horoscope', value: '`/horoscope <sign>`\nsassy star reading. astrology but mean. once per day.', inline: true },
        { name: '\u{1F575}\uFE0F Conspiracy', value: '`/conspiracy @user` or `@Sass conspiracy @user`\nabsurd conspiracy theory using real intel.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F490} Compliment', value: '`@Sass compliment @user`\nbackhanded compliment. sounds nice, stings later.', inline: true },
        { name: '\u{1F440} Status', value: '`/status @user`\nroast someone\'s Discord activity.', inline: true },
      ),

    // Page 5 — Battle & Daily
    new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass \u2014 Battle & Daily', iconURL: botAvatar ?? undefined })
      .addFields(
        { name: '\u2694\uFE0F Roast Battle', value: '`/roastbattle @user`\nPvP roast battle in a thread. 3 rounds. AI judged. 2 min per turn or you forfeit.', inline: false },
        { name: '\u{1F3B2} Dare', value: '`/dare @user`\ni dare someone to do something unhinged. once per day.', inline: true },
        { name: '\u{1F64A} Confess', value: '`/confess @user <confession>`\nanonymous confession delivered by me. once per day.', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '\u{1F52E} Predict', value: '`/predict @user`\ni predict someone\'s future. it\'s never good. once per day per target.', inline: true },
        { name: '\u{1F969} Beef', value: '`/beef @user1 @user2`\ncheck the beef history. i track who\'s been fighting.', inline: true },
      ),
  ];

  // Add page numbers to footers
  pages.forEach((page, i) => {
    page.setFooter({ text: `page ${i + 1}/${pages.length} \u2014 i'm not a helper bot. i'm a problem.`, iconURL: botAvatar ?? undefined });
    page.setTimestamp();
  });

  return pages;
}
