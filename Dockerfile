FROM python:3.12-slim

WORKDIR /app
COPY . /app

ENV HOST=0.0.0.0
ENV PORT=10000
ENV COOKIE_SECURE=1
ENV YODIELAND_DATA_DIR=/var/lib/yodieland

EXPOSE 10000
VOLUME ["/var/lib/yodieland"]
CMD ["python", "server.py"]
