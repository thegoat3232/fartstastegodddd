
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  Collection
} = require("discord.js");
const mongoose = require("mongoose");
const crypto = require("crypto");

/* ---------------- SETUP ---------------- */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

mongoose.connect(process.env.MONGO_URI);

const genCaseId = () => crypto.randomBytes(5).toString("hex");

/* ---------------- SCHEMAS ---------------- */
const GuildConfig = mongoose.model("GuildConfig", new mongoose.Schema({
  guildId: String,
  staffRole: String,
  actionChannel: String,
  logChannel: String,
  promotionRoles: [String]
}));

const Infraction = mongoose.model("Infraction", new mongoose.Schema({
  caseId: { type: String, unique: true },
  staffId: String,
  moderatorId: String,
  reason: String,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  revokedAt: Date,
  revokedBy: String
}));

const Promotion = mongoose.model("Promotion", new mongoose.Schema({
  caseId: { type: String, unique: true },
  staffId: String,
  roleId: String,
  promoterId: String,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  revokedAt: Date,
  revokedBy: String
}));

/* ---------------- HELPERS ---------------- */
async function getConfig(guildId) {
  let cfg = await GuildConfig.findOne({ guildId });
  if (!cfg) cfg = await GuildConfig.create({ guildId });
  return cfg;
}

function hasStaffPerm(member, cfg) {
  if (!cfg.staffRole) return false;
  return member.roles.cache.has(cfg.staffRole);
}

async function sendAction(guild, cfg, embed) {
  if (!cfg.actionChannel) return;
  const ch = guild.channels.cache.get(cfg.actionChannel);
  if (ch) ch.send({ embeds: [embed] });
}

async function sendLog(guild, cfg, embed) {
  if (!cfg.logChannel) return;
  const ch = guild.channels.cache.get(cfg.logChannel);
  if (ch) ch.send({ embeds: [embed] });
}

/* ---------------- COMMANDS ---------------- */
client.commands = new Collection();

/* SET ROLE */
client.commands.set("addrole", {
  data: new SlashCommandBuilder()
    .setName("addrole")
    .setDescription("Set the staff role allowed to manage infractions/promotions")
    .addRoleOption(o => o.setName("role").setRequired(true)),

  async execute(i) {
    if (i.guild.ownerId !== i.user.id)
      return i.reply({ content: "Owner only.", ephemeral: true });

    const role = i.options.getRole("role");
    const cfg = await getConfig(i.guild.id);
    cfg.staffRole = role.id;
    await cfg.save();

    i.reply({ content: `Staff role set to ${role}` });
  }
});

/* SET CHANNEL */
client.commands.set("setchannel", {
  data: new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set channel for bot messages")
    .addChannelOption(o => o.setName("channel").setRequired(true)),

  async execute(i) {
    if (i.guild.ownerId !== i.user.id)
      return i.reply({ content: "Owner only.", ephemeral: true });

    const ch = i.options.getChannel("channel");
    const cfg = await getConfig(i.guild.id);
    cfg.actionChannel = ch.id;
    await cfg.save();

    i.reply({ content: `Action channel set to ${ch}` });
  }
});

/* SET LOGS */
client.commands.set("setlogs", {
  data: new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Set log channel")
    .addChannelOption(o => o.setName("channel").setRequired(true)),

  async execute(i) {
    if (i.guild.ownerId !== i.user.id)
      return i.reply({ content: "Owner only.", ephemeral: true });

    const ch = i.options.getChannel("channel");
    const cfg = await getConfig(i.guild.id);
    cfg.logChannel = ch.id;
    await cfg.save();

    i.reply({ content: `Log channel set to ${ch}` });
  }
});

/* PROMOTION REQUIREMENTS */
client.commands.set("createpromotionreq", {
  data: new SlashCommandBuilder()
    .setName("createpromotionreq")
    .setDescription("Define promotion-required roles")
    .addRoleOption(o => o.setName("role1").setRequired(true))
    .addRoleOption(o => o.setName("role2"))
    .addRoleOption(o => o.setName("role3"))
    .addRoleOption(o => o.setName("role4"))
    .addRoleOption(o => o.setName("role5"))
    .addRoleOption(o => o.setName("role6")),

  async execute(i) {
    if (i.guild.ownerId !== i.user.id)
      return i.reply({ content: "Owner only.", ephemeral: true });

    const roles = [];
    for (let x = 1; x <= 6; x++) {
      const r = i.options.getRole(`role${x}`);
      if (r) roles.push(r.id);
    }

    const cfg = await getConfig(i.guild.id);
    cfg.promotionRoles = roles;
    await cfg.save();

    i.reply({ content: "Promotion requirements saved." });
  }
});

/* PROMOTE */
client.commands.set("promote", {
  data: new SlashCommandBuilder()
    .setName("promote")
    .setDescription("Promote a staff member")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addRoleOption(o => o.setName("role").setRequired(true)),

  async execute(i) {
    const cfg = await getConfig(i.guild.id);
    if (!hasStaffPerm(i.member, cfg))
      return i.reply({ content: "No permission.", ephemeral: true });

    const user = i.options.getUser("user");
    const role = i.options.getRole("role");
    const member = await i.guild.members.fetch(user.id);

    if (!cfg.promotionRoles?.includes(role.id))
      return i.reply({ content: "That role is not promotable.", ephemeral: true });

    await member.roles.add(role);

    const promo = await Promotion.create({
      caseId: genCaseId(),
      staffId: user.id,
      roleId: role.id,
      promoterId: i.user.id
    });

    const embed = new EmbedBuilder()
      .setTitle("📈 Promotion Issued")
      .addFields(
        { name: "User", value: `<@${user.id}>` },
        { name: "Role", value: `<@&${role.id}>` },
        { name: "Case ID", value: promo.caseId }
      )
      .setColor("Green");

    await sendAction(i.guild, cfg, embed);
    await sendLog(i.guild, cfg, embed);
    i.reply({ content: "Promotion successful.", ephemeral: true });
  }
});

/* INFRACTION */
client.commands.set("infraction", {
  data: new SlashCommandBuilder()
    .setName("infraction")
    .setDescription("Infraction commands")
    .addSubcommand(s =>
      s.setName("issue")
        .addUserOption(o => o.setName("user").setRequired(true))
        .addStringOption(o => o.setName("reason").setRequired(true)))
    .addSubcommand(s =>
      s.setName("revoke")
        .addStringOption(o => o.setName("caseid").setRequired(true))),

  async execute(i) {
    const cfg = await getConfig(i.guild.id);
    if (!hasStaffPerm(i.member, cfg))
      return i.reply({ content: "No permission.", ephemeral: true });

    if (i.options.getSubcommand() === "issue") {
      const user = i.options.getUser("user");
      const reason = i.options.getString("reason");

      const inf = await Infraction.create({
        caseId: genCaseId(),
        staffId: user.id,
        moderatorId: i.user.id,
        reason
      });

      const embed = new EmbedBuilder()
        .setTitle("🚨 Infraction Issued")
        .addFields(
          { name: "User", value: `<@${user.id}>` },
          { name: "Reason", value: reason },
          { name: "Case ID", value: inf.caseId }
        )
        .setColor("Red");

      await sendAction(i.guild, cfg, embed);
      await sendLog(i.guild, cfg, embed);
      return i.reply({ content: "Infraction issued.", ephemeral: true });
    }

    if (i.options.getSubcommand() === "revoke") {
      const id = i.options.getString("caseid");
      const inf = await Infraction.findOne({ caseId: id, active: true });
      if (!inf) return i.reply({ content: "Invalid case ID.", ephemeral: true });

      inf.active = false;
      inf.revokedAt = new Date();
      inf.revokedBy = i.user.id;
      await inf.save();

      const embed = new EmbedBuilder()
        .setTitle("❌ Infraction Revoked")
        .addFields({ name: "Case ID", value: id })
        .setColor("Green");

      await sendLog(i.guild, cfg, embed);
      return i.reply({ content: "Infraction revoked.", ephemeral: true });
    }
  }
});

/* ---------------- EVENTS ---------------- */
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;
  const cmd = client.commands.get(i.commandName);
  if (cmd) cmd.execute(i);
});

client.once("ready", () => console.log("Bot online"));
client.login(process.env.DISCORD_TOKEN);
