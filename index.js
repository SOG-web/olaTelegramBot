//7318847242:AAGmAlUCJAEPtPFD8RLfJYddsz3Bh0mDJbI
//-1002233012911

const express = require("express");
const { Telegraf } = require("telegraf");
const fs = require("fs");

const app = express();
const bot = new Telegraf("7318847242:AAGmAlUCJAEPtPFD8RLfJYddsz3Bh0mDJbI");

// File to persist file index
const FILE_INDEX_PATH = "fileIndex.json";

// In-memory storage for user requests and states
const userRequests = {};
const userStates = {};

// Replace with your actual group chat ID
const GROUP_CHAT_ID = "-1002233012911";

// Welcome message for new users and /start command
const welcomeMessage = `Welcome to the group! Here is a guide to get you started:
1. To find a file, send the file name directly to this bot.
2. If the file is not found, you will be prompted to drop a link.
3. An admin will be notified, and the file will be available within 24 hours.`;

// Load file index from JSON file
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

// Save file index to JSON file
const saveFileIndex = () => {
  try {
    fs.writeFileSync(FILE_INDEX_PATH, JSON.stringify(fileIndex, null, 2));
    console.log("File index saved to file.");
  } catch (err) {
    console.error("Failed to save file index:", err);
  }
};

// Handle new chat members
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

// Handle /start command
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

// Function to send confirmation to all admins
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

// Function to extract keywords from a URL
const extractKeywords = (url) => {
  const urlParts = url.split(/[\/\-_.]/).filter((part) => part.length > 2);
  return urlParts;
};

// Function to notify user if their requested file is uploaded and forward the file to them
const notifyUserIfRequested = async (fileName) => {
  const lowerCaseFileName = fileName.toLowerCase();
  for (const [request, requestData] of Object.entries(userRequests)) {
    const keywords = requestData.keywords.map((kw) => kw.toLowerCase());
    if (keywords.some((kw) => lowerCaseFileName.includes(kw))) {
      const userId = requestData.userId;
      await bot.telegram.sendMessage(
        userId,
        `The file "${fileName}" you requested is now available.`
      );
      const messageId = fileIndex[fileName]; // Get the message ID from file index
      console.log(`Forwarding message ID ${messageId} to user ID ${userId}`);
      try {
        await bot.telegram.forwardMessage(userId, GROUP_CHAT_ID, messageId);
        console.log(
          `Successfully forwarded the file "${fileName}" to user ${userId}`
        );
      } catch (err) {
        console.error(
          `Failed to forward the file "${fileName}" to user ${userId}:`,
          err
        );
      }
      delete userRequests[request]; // Remove the request after notifying and forwarding the file to the user
    }
  }
};

// Handle file upload within the group
bot.on("document", async (ctx) => {
  console.log("Received document upload event.");
  if (ctx.chat.type === "supergroup" || ctx.chat.type === "group") {
    console.log("Processing file upload in group.");
    const userId = ctx.message.from.id;

    try {
      // Get the chat member info
      const memberInfo = await bot.telegram.getChatMember(ctx.chat.id, userId);
      console.log(`Member info:`, memberInfo);

      // Check if the user is an admin
      if (
        memberInfo.status === "administrator" ||
        memberInfo.status === "creator"
      ) {
        const fileId = ctx.message.document.file_id;
        const fileName = ctx.message.document.file_name.toLowerCase();
        const uploaderUsername =
          ctx.message.from.username || ctx.message.from.first_name;

        // Store the file information in the fileIndex object
        fileIndex[fileName] = ctx.message.message_id; // Store the original message ID
        saveFileIndex(); // Save the updated file index to the file
        console.log(
          `File "${fileName}" uploaded and indexed by @${uploaderUsername}.`
        );

        // Send confirmation message to all admins
        const confirmationMessage = `File "${fileName}" has been saved and indexed by @${uploaderUsername}.`;
        await sendConfirmationToAdmins(ctx.chat.id, confirmationMessage);

        // Notify the user if their requested file is uploaded and forward the file to them
        await notifyUserIfRequested(fileName);
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

// Middleware to ensure only group members can interact with the bot in DMs
bot.use(async (ctx, next) => {
  if (ctx.chat.type === "private") {
    try {
      console.log(`Checking membership status for user ID: ${ctx.from.id}`);
      // Check if the user is a member of the group
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

// Handle file search and link request in DMs
bot.on("text", async (ctx) => {
  if (ctx.chat.type === "private") {
    const inputText = ctx.message.text;
    console.log(
      `User ${
        ctx.from.username || ctx.from.first_name
      } sent a message: "${inputText}"`
    );

    // Check if the input is a URL
    const urlPattern = /^(https?:\/\/[^\s]+)$/;
    const isURL = urlPattern.test(inputText);

    if (isURL) {
      // If the user provides a URL
      const fileLink = inputText;
      const keywords = extractKeywords(fileLink);
      const requesterName = ctx.from.username || ctx.from.first_name;
      console.log(
        `User ${requesterName} provided link: "${fileLink}" with keywords: ${keywords}`
      );

      ctx.reply("Thank you! Please check back in 24 hours.");

      // Notify all admins
      const requestMessage = `New file request from @${requesterName}:\nFile Link: ${fileLink}\nKeywords: ${keywords.join(
        ", "
      )}`;
      await sendConfirmationToAdmins(GROUP_CHAT_ID, requestMessage);

      // Track the user's request
      userRequests[fileLink] = {
        userId: ctx.from.id,
        keywords,
      };

      // Clean up user state
      delete userStates[ctx.from.id];
    } else if (userStates[ctx.from.id] === "awaiting_link") {
      // If the user is expected to provide a link
      const fileLink = inputText;
      const keywords = extractKeywords(fileLink);
      const requesterName = ctx.from.username || ctx.from.first_name;
      console.log(
        `User ${requesterName} provided link: "${fileLink}" with keywords: ${keywords}`
      );

      ctx.reply("Thank you! Please check back in 24 hours.");

      // Notify all admins
      const requestMessage = `New file request from @${requesterName}:\nFile Link: ${fileLink}\nKeywords: ${keywords.join(
        ", "
      )}`;
      await sendConfirmationToAdmins(GROUP_CHAT_ID, requestMessage);

      // Track the user's request
      userRequests[fileLink] = {
        userId: ctx.from.id,
        keywords,
      };

      // Clean up user state
      delete userStates[ctx.from.id];
    } else {
      // Check if the input text matches any file names
      const searchResults = Object.keys(fileIndex).filter((fileName) =>
        fileName.includes(inputText.toLowerCase())
      );

      if (searchResults.length > 0) {
        ctx.reply(`Found the following files:\n${searchResults.join("\n")}`);
        searchResults.forEach(async (fileName) => {
          const messageId = fileIndex[fileName];
          console.log(
            `Forwarding message ID ${messageId} for file "${fileName}" to user ID ${ctx.from.id}`
          );
          try {
            await bot.telegram.forwardMessage(
              ctx.from.id,
              GROUP_CHAT_ID,
              messageId
            );
            console.log(
              `Successfully forwarded the file "${fileName}" to user ${ctx.from.id}`
            );
          } catch (err) {
            console.error(
              `Failed to forward the file "${fileName}" to user ${ctx.from.id}:`,
              err
            );
          }
        });
      } else {
        ctx.reply(
          "File not found. Please drop the link of the file you are looking for."
        );
        userStates[ctx.from.id] = "awaiting_link";
      }
    }
  }
});

// Function to check bot permissions
const checkBotPermissions = async (chatId) => {
  try {
    const botInfo = await bot.telegram.getMe();
    if (!botInfo) {
      throw new Error("Bot info is not available yet.");
    }
    const botId = botInfo.id;
    const memberInfo = await bot.telegram.getChatMember(chatId, botId);
    const canDeleteMessages = memberInfo.can_delete_messages;
    console.log(`Bot has permission to delete messages: ${canDeleteMessages}`);
  } catch (err) {
    console.error("Failed to get bot permissions:", err);
  }
};

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Start the bot and check permissions after launch
const startBot = async (retryCount = 0) => {
  try {
    await bot.launch();
    console.log("Bot started");
    await checkBotPermissions(GROUP_CHAT_ID);
  } catch (err) {
    console.error("Failed to start bot", err);
    if (retryCount < 5) {
      console.log(`Retrying to start bot... Attempt ${retryCount + 1}`);
      setTimeout(() => startBot(retryCount + 1), 5000);
    } else {
      console.error("Max retry attempts reached. Could not start bot.");
    }
  }
};

startBot();
