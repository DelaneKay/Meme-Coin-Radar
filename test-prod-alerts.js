#!/usr/bin/env node

/**
 * Production Alert Channel Test Script
 * Sends test messages to verify Discord and Telegram channels are working
 */

const axios = require('axios');
require('dotenv').config({ path: './api/.env' });

class ProductionAlertTester {
  constructor() {
    this.discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL_PROD;
    this.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN_PROD;
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID_PROD;
  }

  async sendDiscordTestMessage(alertType) {
    if (!this.discordWebhookUrl) {
      console.log('❌ Discord webhook URL not configured');
      return false;
    }

    try {
      const embed = {
        title: `🧪 [TEST] ${alertType} Channel Test`,
        description: `${alertType} channel is live and operational`,
        color: alertType === 'RADAR' ? 0x3b82f6 : 0x10b981, // Blue for RADAR, Green for CEX
        fields: [
          {
            name: '🔧 Environment',
            value: 'Production',
            inline: true
          },
          {
            name: '⏰ Timestamp',
            value: new Date().toISOString(),
            inline: true
          },
          {
            name: '📊 Alert Type',
            value: alertType === 'RADAR' ? 'Momentum Alerts' : 'CEX Listing Alerts',
            inline: true
          }
        ],
        footer: {
          text: 'Meme Coin Radar - Production Test'
        },
        timestamp: new Date().toISOString()
      };

      const payload = {
        embeds: [embed],
        username: 'Meme Coin Radar Test',
        avatar_url: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4e1.png'
      };

      const response = await axios.post(this.discordWebhookUrl, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 204) {
        console.log(`✅ Discord ${alertType} test message sent successfully`);
        return true;
      } else {
        console.log(`❌ Discord ${alertType} test failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Discord ${alertType} test error:`, error.message);
      return false;
    }
  }

  async sendTelegramTestMessage(alertType) {
    if (!this.telegramBotToken || !this.telegramChatId) {
      console.log('❌ Telegram credentials not configured');
      return false;
    }

    try {
      const emoji = alertType === 'RADAR' ? '📡' : '🚀';
      const message = `${emoji} *[TEST] ${alertType} CHANNEL IS LIVE*

🔧 *Environment:* Production
⏰ *Timestamp:* ${new Date().toISOString()}
📊 *Alert Type:* ${alertType === 'RADAR' ? 'Momentum Alerts' : 'CEX Listing Alerts'}

✅ Channel is operational and ready for production alerts.

_Meme Coin Radar - Production Test_`;

      const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;
      const payload = {
        chat_id: this.telegramChatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      };

      const response = await axios.post(url, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 200 && response.data.ok) {
        console.log(`✅ Telegram ${alertType} test message sent successfully`);
        return true;
      } else {
        console.log(`❌ Telegram ${alertType} test failed:`, response.data);
        return false;
      }
    } catch (error) {
      console.log(`❌ Telegram ${alertType} test error:`, error.message);
      return false;
    }
  }

  async runAllTests() {
    console.log('🧪 Starting Production Alert Channel Tests\n');

    const results = {
      discord: {
        radar: false,
        cex: false
      },
      telegram: {
        radar: false,
        cex: false
      }
    };

    // Test Discord channels
    console.log('📢 Testing Discord Channels...');
    results.discord.radar = await this.sendDiscordTestMessage('RADAR');
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    results.discord.cex = await this.sendDiscordTestMessage('CEX LISTING');

    console.log('\n📱 Testing Telegram Channels...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    results.telegram.radar = await this.sendTelegramTestMessage('RADAR');
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    results.telegram.cex = await this.sendTelegramTestMessage('CEX LISTING');

    // Summary
    console.log('\n📊 Test Results Summary:');
    console.log('Discord:');
    console.log(`  RADAR: ${results.discord.radar ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  CEX LISTING: ${results.discord.cex ? '✅ PASS' : '❌ FAIL'}`);
    console.log('Telegram:');
    console.log(`  RADAR: ${results.telegram.radar ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  CEX LISTING: ${results.telegram.cex ? '✅ PASS' : '❌ FAIL'}`);

    const totalTests = 4;
    const passedTests = Object.values(results.discord).filter(Boolean).length + 
                       Object.values(results.telegram).filter(Boolean).length;
    
    console.log(`\n📈 Overall Success Rate: ${passedTests}/${totalTests} (${((passedTests/totalTests)*100).toFixed(1)}%)`);

    if (passedTests === totalTests) {
      console.log('\n🎉 All production alert channels are operational!');
    } else {
      console.log('\n⚠️  Some channels failed - check configuration');
    }

    return results;
  }

  checkConfiguration() {
    console.log('🔍 Checking Production Alert Configuration...\n');

    console.log('Environment Variables:');
    console.log(`  NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`  ALERT_TYPES_ENABLED: ${process.env.ALERT_TYPES_ENABLED}`);
    console.log(`  DISCORD_WEBHOOK_URL_PROD: ${this.discordWebhookUrl ? '✅ Set' : '❌ Missing'}`);
    console.log(`  TELEGRAM_BOT_TOKEN_PROD: ${this.telegramBotToken ? '✅ Set' : '❌ Missing'}`);
    console.log(`  TELEGRAM_CHAT_ID_PROD: ${this.telegramChatId ? '✅ Set' : '❌ Missing'}`);

    console.log('\nAlert Thresholds:');
    console.log(`  RADAR_MOMENTUM_THRESHOLD: ${process.env.RADAR_MOMENTUM_THRESHOLD || 'Not set'}`);
    console.log(`  CEX_LISTING_COOLDOWN_HOURS: ${process.env.CEX_LISTING_COOLDOWN_HOURS || 'Not set'}`);

    const enabledTypes = process.env.ALERT_TYPES_ENABLED?.split(',') || [];
    console.log('\nEnabled Alert Types:');
    enabledTypes.forEach(type => {
      console.log(`  ✅ ${type}`);
    });

    console.log('');
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ProductionAlertTester();
  
  tester.checkConfiguration();
  
  tester.runAllTests()
    .then(results => {
      const allPassed = Object.values(results.discord).every(Boolean) && 
                       Object.values(results.telegram).every(Boolean);
      process.exit(allPassed ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    });
}

module.exports = ProductionAlertTester;