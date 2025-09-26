import logging
import os
import asyncio
import re
import shutil
import uuid
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# Mengatur logging dasar
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Fungsi untuk perintah /start
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Mengirim pesan sapaan ketika perintah /start dijalankan."""
    user = update.effective_user
    await update.message.reply_html(
        rf"Hai {user.mention_html()}!",
        reply_markup=None,
    )
    await update.message.reply_text("Kirimkan saya tautan video, dan saya akan mencoba mengunduhnya untuk Anda.")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handles non-command messages, expecting a video URL."""
    message_text = update.message.text
    # A simple regex to find the first URL in the message
    url_match = re.search(r'https?://[^\s]+', message_text)

    if not url_match:
        # No URL found, we can optionally reply with a help message.
        # For now, we just ignore messages without URLs.
        return

    url = url_match.group(0)
    status_message = await update.message.reply_text("Memproses tautan, mohon tunggu...")

    # Create a unique directory for the download to avoid filename conflicts
    download_dir = f"download_{uuid.uuid4()}"
    os.makedirs(download_dir)

    try:
        output_template = os.path.join(download_dir, '%(title)s.%(ext)s')

        command = [
            'yt-dlp',
            '-f', 'best[filesize<49M]', # Use 49M to be safe with Telegram's 50MB limit
            '--merge-output-format', 'mp4',
            '-o', output_template,
            url,
        ]

        await status_message.edit_text("Mengunduh video... (ini mungkin butuh beberapa saat)")

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_message = stderr.decode('utf-8', errors='ignore').strip()
            logger.error(f"yt-dlp error: {error_message}")
            if "File is larger than" in error_message:
                 await status_message.edit_text("Gagal: Video terlalu besar untuk diunduh (batas 50MB).")
            else:
                await status_message.edit_text("Gagal mengunduh video. Tautan mungkin tidak didukung atau video dilindungi.")
            return

        # Find the downloaded file inside the unique directory
        files = os.listdir(download_dir)
        if not files:
            await status_message.edit_text("Gagal: Tidak ada file yang diunduh.")
            return

        downloaded_file_path = os.path.join(download_dir, files[0])

        await status_message.edit_text("Mengunggah video ke Telegram...")

        # Send the video file
        await update.message.reply_video(
            video=open(downloaded_file_path, 'rb'),
            supports_streaming=True,
            read_timeout=120,
            write_timeout=120,
            connect_timeout=120
        )

        # Delete the status message as the job is done
        await status_message.delete()

    except Exception as e:
        logger.error(f"Error saat memproses video: {e}")
        await status_message.edit_text(f"Terjadi kesalahan yang tidak terduga: {e}")
    finally:
        # Clean up the download directory and its contents
        if os.path.exists(download_dir):
            shutil.rmtree(download_dir)


# Fungsi utama untuk menjalankan bot
def main() -> None:
    """Memulai bot Telegram."""
    # Mengambil token dari environment variable
    token = os.getenv("TELEGRAM_TOKEN")
    if not token:
        logger.error("TELEGRAM_TOKEN environment variable tidak diatur!")
        return

    # Membuat Application
    application = Application.builder().token(token).build()

    # Menambahkan handler untuk perintah /start
    application.add_handler(CommandHandler("start", start))

    # Menambahkan handler untuk pesan teks (URL video)
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Menjalankan bot
    logger.info("Bot dimulai...")
    application.run_polling()

if __name__ == '__main__':
    main()