FROM python:3.13-alpine
RUN apk add --no-cache ffmpeg openssl
WORKDIR /app
COPY worker.py selection_playlists.py ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python3", "-B", "/app/worker.py"]
