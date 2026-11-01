from flask import Flask, jsonify, render_template, request

from cube import InvalidCube, cube_from_stickers
from solver import scramble, solve

app = Flask(__name__, static_folder="public", static_url_path="")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/solve", methods=["POST"])
def solve_route():
    data = request.get_json(silent=True) or {}
    stickers = data.get("stickers")

    if not isinstance(stickers, str):
        return jsonify(error="Send the cube's stickers as text."), 400

    try:
        cube = cube_from_stickers(stickers)
    except InvalidCube as error:
        return jsonify(error=str(error)), 400

    return jsonify(solve(cube))


@app.route("/api/scramble", methods=["POST"])
def scramble_route():
    return jsonify(moves=scramble())


if __name__ == "__main__":
    app.run(port=5001)
