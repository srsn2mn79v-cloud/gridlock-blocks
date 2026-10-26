GRIDLOCK RADIO - how to add your own music
==========================================
1. Make a folder per radio station inside this folder:      public/radio/night-drive/   public/radio/low-key/
2. Drop your songs in it (mp3, m4a, ogg, wav, aac or flac).
3. Optional: a station.json in the same folder to name the station and set its DJ voice, e.g.
      { "name": "Low Key FM", "djName": "Maya", "pitch": 0.95, "rate": 0.95 }
   (set "dj": false for a station without a DJ)
4. Build / push as usual. The build lists the folders itself (tools/radio-manifest.mjs).
In the game press R (or tap the radio pill, top right) to switch station; the stations also play in your garage.
Only use music you have the rights to. The two built-in stations (Neon Drive, Low Key) are synthesised and need no files.
