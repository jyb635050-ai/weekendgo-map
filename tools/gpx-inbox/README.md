# 队员 GPX 投递箱 / Team GPX inbox

把队员实地录制的轨迹放进这里，就会以「那我走实测」显示在地图上，并排在所有 OSM 路线前面。

1. 在这个目录下，按山的 id 建一个文件夹（id 见 `data/mountains.json`，例如 `pulag`、`batulao`、`tagapo`）
2. 把 GPX 文件放进去，**文件名就是路线名**，例如 `pulag/Akiki Trail.gpx`、`batulao/新线 2026.gpx`
   - 两步路：轨迹 → 导出 → GPX；Strava：活动 → ⋯ → 导出 GPX；Gaia / Garmin / Relive 同理
3. 运行：`python tools/import_gpx.py`（只导某座山：`python tools/import_gpx.py pulag`）
4. 导入成功的文件会移到 `_imported/`，然后 `git push` 部署即可

要求：轨迹必须经过山顶 600 m 以内（没登顶的记录会被跳过）。往返轨迹只取上山段。
