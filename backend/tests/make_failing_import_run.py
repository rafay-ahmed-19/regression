# Helper: import the fixture folder until a fx-rounding run fails on rGLPosting; prints suite/run ids
import os, time, requests
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
for i in range(8):
    with open("/tmp/fx/folder.zip", "rb") as f:
        d = requests.post(f"{API}/import/folder", data={"name": f"TEST_UI_fail_{i}", "build_folder": "test/x"},
                          files=[("files", ("folder.zip", f.read(), "application/zip"))]).json()
    rid = requests.post(f"{API}/runs", json={"suite_id": d["suite_id"], "branch": "feature/fx-rounding"}).json()["id"]
    while (run := requests.get(f"{API}/runs/{rid}").json())["status"] == "running":
        time.sleep(1)
    gl = next(x for x in run["results"] if x["sheet_name"] == "rGLPosting")
    if gl["status"] == "failed":
        print("SUITE", d["suite_id"], "RUN", rid)
        break
    requests.delete(f"{API}/suites/{d['suite_id']}")
