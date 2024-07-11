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
    You are an AI assistant that helps translate natural language queries into Cypher queries for a Neo4j graph database. 
    The ServiceBulletin node's name is actually the number of that particular service bulletin.
    Here is the schema of the database:

        Nodes:
    1. parts_required
    2. concurrent_requirements
    3. reason
    4. subject
    5. spares_affected
    6. material_information
    7. description
    8. section
    9. title
    10. content
    11. number
    12. ServiceBulletin
    13. manpower
    14. text
    15. accomplishment_instructions
    16. summary
    17. effectivity
    18. tooling_required
    19. approval
    20. planning_information
    21. appendix_a
    22. airplanes
    23. total_per_airplane
    24. persons
    25. work_instructions
    26. task
    27. ata_system
    28. task_hours
    29. original_issue_date
    30. background
    31. compliance
    32. elapsed_hours
    33. name
    34. header
    35. step

    Relationships:
    1. parts_required: (material_information)-[:parts_required]->(parts_required)
    2. concurrent_requirements: (planning_information)-[:concurrent_requirements]->(concurrent_requirements)
    3. reason: (planning_information)-[:reason]->(reason)
    4. subject: (header)-[:subject]->(subject)
    5. spares_affected: (effectivity)-[:spares_affected]->(spares_affected)
    6. material_information: (ServiceBulletin)-[:material_information]->(material_information)
    7. description: (summary)-[:description]->(description), (planning_information)-[:description]->(description)
    8. section: (appendix_a)-[:section]->(section)
    9. title: (section)-[:title]->(title), (appendix_a)-[:title]->(title)
    10. content: (section)-[:content]->(content)
    11. number: (header)-[:number]->(number), (step)-[:number]->(number)
    12. manpower: (planning_information)-[:manpower]->(manpower)
    13. text: (step)-[:text]->(text)
    14. accomplishment_instructions: (ServiceBulletin)-[:accomplishment_instructions]->(accomplishment_instructions)
    15. summary: (ServiceBulletin)-[:summary]->(summary)
    16. effectivity: (planning_information)-[:effectivity]->(effectivity)
    17. tooling_required: (material_information)-[:tooling_required]->(tooling_required)
    18. approval: (planning_information)-[:approval]->(approval)
    19. planning_information: (ServiceBulletin)-[:planning_information]->(planning_information)
    20. appendix_a: (ServiceBulletin)-[:appendix_a]->(appendix_a)
    21. airplanes: (effectivity)-[:airplanes]->(airplanes)
    22. total_per_airplane: (manpower)-[:total_per_airplane]->(total_per_airplane)
    23. work_instructions: (accomplishment_instructions)-[:work_instructions]->(work_instructions)
    24. persons: (task)-[:persons]->(persons)
    25. task: (manpower)-[:task]->(task)
    26. ata_system: (header)-[:ata_system]->(ata_system)
    27. task_hours: (task)-[:task_hours]->(task_hours), (total_per_airplane)-[:task_hours]->(task_hours)
    28. compliance: (planning_information)-[:compliance]->(compliance)
    29. original_issue_date: (header)-[:original_issue_date]->(original_issue_date)
    30. background: (summary)-[:background]->(background)
    31. elapsed_hours: (total_per_airplane)-[:elapsed_hours]->(elapsed_hours), (task)-[:elapsed_hours]->(elapsed_hours)
    32. name: (task)-[:name]->(name)
    33. header: (ServiceBulletin)-[:header]->(header)
    34. step: (description)-[:step]->(step), (work_instructions)-[:step]->(step)

    Here is the chat history:
    {chat_history}

    Convert the last user query into a Cypher query for the Neo4j database. Make sure the query retrieves the matched node and its connected nodes up to three levels deep in the downward direction (nodes that the current node points to, and the nodes that those nodes point to):
    JUST RETURN THE QUERY AND NOTHING ELSE.
    Cypher Query:
    """

    try:
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

        logger.debug(f"Before Stripping: {gpt4_response.choices[0].message.content}")
        cypher_query = gpt4_response.choices[0].message.content.strip().strip("`")
        logger.debug(f"After Stripping: {cypher_query}")
        result = run_query(cypher_query)

        if result is None:
            return jsonify({"error": "Error running query"}), 500

        # Check if result has the expected structure before processing
        if isinstance(result, list) and all('m' in record and 'connected' in record for record in result):
            # Format the result into a nested structure
            formatted_result = {}
            for record in result:
                node_name = record['m']['name']
                if node_name not in formatted_result:
                    formatted_result[node_name] = []
                formatted_result[node_name].append(record['connected'])
            result_to_process = formatted_result
        else:
            # Pass the result as it is to GPT-4
            result_to_process = result
        
        # Generate natural language explanation
        result_prompt = f"Translate the following database result into a natural language explanation: {result_to_process}"

        # logger.debug(f"ABCDEFG: {result}")

        gpt4_response_final = openai.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that converts database results into natural language explanations."},
                {"role": "user", "content": user_query},
                {"role": "user", "content": f"Translate the following database result into a natural language explanation: Keep the answer brief and short. And just the answer. Don't give extra info than the question asked. Always start the answer, a bit from the question, only a bit. \n\n{result_to_process}"}
            ],
            temperature=0.7,
            max_tokens=1500,
            top_p=1
        )

        explanation = gpt4_response_final.choices[0].message.content.strip()
        return jsonify({"explanation": explanation})
    except Exception as e:
        logger.error(f"Error processing chat: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, debug=True)
