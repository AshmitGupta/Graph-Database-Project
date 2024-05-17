from flask import Flask, request, jsonify, render_template
from neo4j import GraphDatabase
import openai
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)

uri = os.getenv("NEO4J_URI")
username = os.getenv("NEO4J_USERNAME")
password = os.getenv("NEO4J_PASSWORD")

driver = GraphDatabase.driver(uri, auth=(username, password))

def run_query(query):
    try:
        with driver.session() as session:
            result = session.run(query)
            return [record.data() for record in result]
    except Exception as e:
        app.logger.error(f"Error running query: {str(e)}")
        return None

openai.api_key = os.getenv("OPENAI_API_KEY")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/gpt-query', methods=['POST'])
def gpt_query():
    user_query = request.json.get("query")
    if not user_query:
        return jsonify({"error": "No query provided"}), 400

    # Schema information and prompt template
    prompt_template = """
    You are an AI assistant that helps translate natural language queries into Cypher queries for a Neo4j graph database. Here is the schema of the database:

    Nodes:
    - PLAYER: {{name, age, number, height, weight}}
    - COACH: {{name}}
    - TEAM: {{name}}

    Relationships:
    - TEAMMATES: between PLAYER and PLAYER
    - COACHES: from COACH to PLAYER
    - PLAYS_FOR: from PLAYER to TEAM {{salary}}
    - COACHES_FOR: from COACH to TEAM
    - PLAYED_AGAINST: from PLAYER to TEAM {{minutes, points, assists, rebounds, turnovers}}

    Examples:

    1. Natural Language: "Show all players coached by Frank Vogel"
       Cypher Query: MATCH (c:COACH {{name: "Frank Vogel"}})-[:COACHES]->(p:PLAYER) RETURN p.name, p.age, p.number, p.height, p.weight

    2. Natural Language: "List all teammates of LeBron James"
       Cypher Query: MATCH (p:PLAYER {{name: "LeBron James"}})-[:TEAMMATES]-(teammate:PLAYER) RETURN teammate.name, teammate.age, teammate.number, teammate.height, teammate.weight

    Now, convert the following natural language query to a Cypher query:
    Natural Language: "{user_query}"
    Cypher Query:
    """

    prompt = prompt_template.format(user_query=user_query)

    try:
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that converts natural language to Cypher queries for Neo4j."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=150,
            top_p=1
        )

        cypher_query = response.choices[0].message.content.strip()
        result = run_query(cypher_query)
        if result is None:
            return jsonify({"error": "Error running query"}), 500

        gpt4_response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that converts database results into natural language explanations."},
                {"role": "user", "content": prompt},
                {"role": "user", "content": f"Translate the following database result into a natural language explanation: Keep the answer brief and short. And just the answer. Don't give extra info than the question asked. \n\n{result}"}
            ],
            temperature=0.7,
            max_tokens=150,
            top_p=1
        )

        explanation = gpt4_response.choices[0].message.content.strip()
        return jsonify({"explanation": explanation})
    except Exception as e:
        app.logger.error(f"Error processing query: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
