process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

const express = require("express");
const { Telegraf } = require("telegraf");
const fs = require("fs");

const app = express();
const bot = new Telegraf("7426370438:AAHxJMhID6h5clGmRAwrVahMf9G-8AcFm30"); // Replace with your actual bot token

const FILE_INDEX_PATH = "fileIndex.json";
const userRequests = {};
const userStates = {};
const GROUP_CHAT_ID = "-4230027494";

const welcomeMessage = `Welcome to the group! Here is a guide to get you started:
1. To find a file, send the file name directly to this bot.
2. If the file is not found, you will be prompted to drop a link.
3. An admin will be notified, and the file will be available within 24 hours.`;

let fileIndex = {};
if (fs.existsSync(FILE_INDEX_PATH)) {
  try {
    const data = fs.readFileSync(FILE_INDEX_PATH, "utf-8");
    fileIndex = JSON.parse(data);
    console.log("File index loaded from file.");
  } catch (err) {
    console.error("Failed to load file index:", err);
  }
}

const saveFileIndex = () => {
  try {
    fs.writeFileSync(FILE_INDEX_PATH, JSON.stringify(fileIndex, null, 2));
    console.log("File index saved to file.");
  } catch (err) {
    console.error("Failed to save file index:", err);
  }
};

bot.on("new_chat_members", (ctx) => {
  ctx.message.new_chat_members.forEach((newMember) => {
    bot.telegram
      .sendMessage(newMember.id, welcomeMessage)
      .then(() =>
        console.log(
          `Sent welcome message to ${
            newMember.username || newMember.first_name
          }`
        )
      )
      .catch((err) =>
        console.error(
          `Failed to send welcome message to ${
            newMember.username || newMember.first_name
          }`,
          err
        )
      );
  });
});

bot.start((ctx) => {
  ctx
    .reply(welcomeMessage)
    .then(() =>
      console.log(
        `Sent welcome message to ${ctx.from.username || ctx.from.first_name}`
      )
    )
    .catch((err) =>
      console.error(
        `Failed to send welcome message to ${
          ctx.from.username || ctx.from.first_name
        }`,
        err
      )
    );
});

const sendConfirmationToAdmins = async (chatId, message) => {
  try {
    console.log(`Fetching chat administrators for chat ID: ${chatId}`);
    const admins = await bot.telegram.getChatAdministrators(chatId);
    console.log(`Found ${admins.length} admins.`);
    admins.forEach((admin) => {
      bot.telegram
        .sendMessage(admin.user.id, message)
        .then(() =>
          console.log(
            `Sent confirmation to ${
              admin.user.username || admin.user.first_name
            }`
          )
        )
        .catch((err) =>
          console.error(
            `Failed to send confirmation to ${
              admin.user.username || admin.user.first_name
            }`,
            err
          )
        );
    });
  } catch (err) {
    console.error("Failed to get chat administrators:", err);
  }
};

bot.on("document", async (ctx) => {
  console.log("Received document upload event.");
  if (ctx.chat.type === "supergroup" || ctx.chat.type === "group") {
    console.log("Processing file upload in group.");
    const userId = ctx.message.from.id;

    try {
      const memberInfo = await bot.telegram.getChatMember(ctx.chat.id, userId);
      console.log(`Member info:`, memberInfo);

      if (
        memberInfo.status === "administrator" ||
        memberInfo.status === "creator"
      ) {
        const fileId = ctx.message.document.file_id;
        const fileName = ctx.message.document.file_name.toLowerCase();
        const uploaderUsername =
          ctx.message.from.username || ctx.message.from.first_name;

        fileIndex[fileName] = ctx.message.message_id;
        saveFileIndex();
        console.log(
          `File "${fileName}" uploaded and indexed by @${uploaderUsername}.`
        );

        const confirmationMessage = `File "${fileName}" has been saved and indexed by @${uploaderUsername}.`;
        await sendConfirmationToAdmins(ctx.chat.id, confirmationMessage);
      } else {
        console.log(
          `User ${
            ctx.message.from.username || ctx.message.from.first_name
          } is not an admin, ignoring file upload.`
        );
      }
    } catch (err) {
      console.error("Failed to get chat member info:", err);
    }
  } else {
    console.log("File upload received from non-group chat, ignoring.");
  }
});

bot.use(async (ctx, next) => {
  if (ctx.chat.type === "private") {
    try {
      console.log(`Checking membership status for user ID: ${ctx.from.id}`);
      const memberInfo = await bot.telegram.getChatMember(
        GROUP_CHAT_ID,
        ctx.from.id
      );
      if (
        memberInfo.status === "member" ||
        memberInfo.status === "administrator" ||
        memberInfo.status === "creator"
      ) {
        return next();
      } else {
        ctx.reply("Only group members can interact with this bot.");
      }
    } catch (err) {
      console.error("Failed to get chat member info:", err);
      ctx.reply("An error occurred. Please try again later.");
    }
  } else {
    return next();
  }
});

bot.on("text", async (ctx) => {
  if (ctx.chat.type === "private") {
    const inputText = ctx.message.text;
    console.log(
      `User ${
        ctx.from.username || ctx.from.first_name
      } sent a message: "${inputText}"`
    );

    const urlPattern = /^(https?:\/\/[^\s]+)$/;
    const isURL = urlPattern.test(inputText);

    if (isURL) {
      const fileLink = inputText;
      const requesterName = ctx.from.username || ctx.from.first_name;
      console.log(`User ${requesterName} provided link: "${fileLink}"`);

      ctx.reply("Thank you! Please check back in 24 hours.");

      const requestMessage = `New file request from @${requesterName}:\nFile Link: ${fileLink}`;
      await sendConfirmationToAdmins(GROUP_CHAT_ID, requestMessage);

      userRequests[fileLink] = {
        userId: ctx.from.id,
        fileLink,
      };

      delete userStates[ctx.from.id];
    } else if (userStates[ctx.from.id] === "awaiting_link") {
      const fileLink = inputText;
      const requesterName = ctx.from.username || ctx.from.first_name;
      console.log(`User ${requesterName} provided link: "${fileLink}"`);

      ctx.reply("Thank you! Please check back in 24 hours.");

      const requestMessage = `New file request from @${requesterName}:\nFile Name: ${
        userStates[ctx.from.id].fileName
      }\nFile Link: ${fileLink}`;
      await sendConfirmationToAdmins(GROUP_CHAT_ID, requestMessage);

      userRequests[userStates[ctx.from.id].fileName] = {
        userId: ctx.from.id,
        fileLink,
      };

      delete userStates[ctx.from.id];
    } else {
      const searchResults = Object.keys(fileIndex).filter((fileName) =>
        fileName.includes(inputText.toLowerCase())
      );

      if (searchResults.length > 0) {
        ctx.reply(`Found the following files:\n${searchResults.join("\n")}`);
        searchResults.forEach((fileName) => {
          const messageId = fileIndex[fileName];
          bot.telegram.forwardMessage(ctx.from.id, GROUP_CHAT_ID, messageId);
        });
      } else {
        ctx.reply(
          "File not found. Please drop the link of the file you are looking for."
        );
        userStates[ctx.from.id] = {
          state: "awaiting_link",
          fileName: inputText.toLowerCase(),
        };
      }
    }
  }
});

bot.launch();
console.log("Bot is running.");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
