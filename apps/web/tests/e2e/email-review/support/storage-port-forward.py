import asyncio

async def relay(reader, writer):
    try:
        while (chunk := (await reader.read(65536))):
            writer.write(chunk)
            await writer.drain()
    finally:
        writer.close()

async def accept(reader, writer):
    try:
        remote_reader, remote_writer = await asyncio.open_connection('127.0.0.1', 24706)
        await asyncio.gather(relay(reader, remote_writer), relay(remote_reader, writer))
    except (ConnectionError, asyncio.CancelledError):
        writer.close()

async def main():
    server = await asyncio.start_server(accept, '127.0.0.1', 4566)
    print('Local S3 compatibility forward: 127.0.0.1:4566 -> 127.0.0.1:24706', flush=True)
    async with server:
        await server.serve_forever()
asyncio.run(main())
