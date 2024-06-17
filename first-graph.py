from flask import Flask, request, jsonify, render_template
from neo4j import GraphDatabase, TRUST_SYSTEM_CA_SIGNED_CERTIFICATES
import openai
from dotenv import load_dotenv
import os
import logging

load_dotenv()

app = Flask(__name__)
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG)

# uri = os.getenv("NEO4J_URI")
# username = os.getenv("NEO4J_USERNAME")
# password = os.getenv("NEO4J_PASSWORD")

uri = os.getenv("NEO4J_URI")
username = os.getenv("NEO4J_USERNAME")
password = os.getenv("NEO4J_PASSWORD")

driver = None
try:
    driver = GraphDatabase.driver(uri, auth=(username, password))
    logger.info("Neo4j driver created successfully")
except Exception as e:
    logger.error(f"Error creating Neo4j driver: {str(e)}")

def run_query(query):
    try:
        with driver.session() as session:
            result = session.run(query)
            return [record.data() for record in result]
    except Exception as e:
        logger.error(f"Error running query: {str(e)}")
        return None

openai.api_key = os.getenv("OPENAI_API_KEY")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/visualise')
def visualise():
    return render_template('visualise.html')

@app.route('/gpt4-chat', methods=['POST'])
def gpt4_chat():
    data = request.json
    messages = data.get('messages')

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    # Create a prompt for GPT-4 to generate a Cypher query
    chat_history = "\n".join([f"{msg['role']}: {msg['content']}" for msg in messages])
    user_query = messages[-1]['content']

    prompt_template = f"""
    You are an AI assistant that helps translate natural language queries into Cypher queries for a Neo4j graph database. Here is the schema of the database:

    Nodes:
    - ServiceBulletin: {{number, subject, issueDate}}
    - Section: {{name}}
    - Subsection: {{name, info}}

    Relationships:
    - HAS_SECTION: from ServiceBulletin to Section
    - HAS_SUBSECTION: from Section to Subsection

    Here is the chat history:
    {chat_history}

    Examples:

    1. Natural Language: "List all sections in the service bulletin 737-00-1028"
    Cypher Query: MATCH (sb:ServiceBulletin {{number: "737-00-1028"}})-[:HAS_SECTION]->(s:Section) RETURN s.name

    2. Natural Language: "Show all subsections under PLANNING INFORMATION"
    Cypher Query: MATCH (sec:Section {{name: "PLANNING INFORMATION"}})-[:HAS_SUBSECTION]->(sub:Subsection) RETURN sub.name, sub.info

    3. Natural Language: "What is the information for the Effectivity subsection?"
    Cypher Query: MATCH (sub:Subsection {{name: "Effectivity"}}) RETURN sub.info

    Convert the last user query into a Cypher query for the Neo4j database:
    JUST RETURN THE QUERY AND NOTHING ELSE.
    Cypher Query:

    """

    try:
        logger.debug(f"Prompt for GPT-4: {prompt_template}")
        # Generate Cypher query
        gpt4_response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that converts natural language to Cypher queries for Neo4j."},
                {"role": "user", "content": prompt_template}
            ],
            temperature=0.7,
            max_tokens=150,
            top_p=1
        )

        cypher_query = gpt4_response.choices[0].message.content.strip().strip("`")
        result = run_query(cypher_query)

        if result is None:
            return jsonify({"error": "Error running query"}), 500

        # Generate natural language explanation
        result_prompt = f"Translate the following database result into a natural language explanation: {result}"

        gpt4_response_final = openai.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that converts database results into natural language explanations."},
                {"role": "user", "content": user_query},
                {"role": "user", "content": f"Translate the following database result into a natural language explanation: Keep the answer brief and short. And just the answer. Don't give extra info than the question asked. Always start the answer, a bit from the question, only a bit. \n\n{result}"}
            ],
            temperature=0.7,
            max_tokens=150,
            top_p=1
        )

        explanation = gpt4_response_final.choices[0].message.content.strip()
        return jsonify({"explanation": explanation})
    except Exception as e:
        logger.error(f"Error processing chat: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, debug=True)
