from neo4j import GraphDatabase

# Connect to the Neo4j instance
uri = "your_neo4j_url"  # Replace with your Neo4j URL
username = "your_username"  # Replace with your Neo4j username
password = "your_password"  # Replace with your Neo4j password
driver = GraphDatabase.driver(uri, auth=(username, password))

# List of XML files
xml_files = [
    'boeing_service_bulletin_1.xml',
    'boeing_service_bulletin_2.xml',
    'boeing_service_bulletin_3.xml'
]

# Function to create a tagged node
def create_tagged_node(tx, label, properties, tag):
    properties[tag] = True
    result = tx.run(f"CREATE (n:{label} $properties) RETURN id(n)", properties=properties)
    return result.single()[0]

# Function to create relationships
def create_relationship(tx, from_node_id, to_node_id, relationship_type):
    tx.run(
        "MATCH (a), (b) WHERE id(a) = $from_node_id AND id(b) = $to_node_id "
        "CREATE (a)-[r:" + relationship_type + "]->(b)",
        from_node_id=from_node_id, to_node_id=to_node_id
    )

# Function to match or create a tagged node
def match_or_create_tagged_node(tx, label, properties, tag):
    result = tx.run(
        f"MATCH (n:{label} $properties) RETURN id(n)",
        properties=properties
    )
    record = result.single()
    if record:
        return record[0]
    else:
        return create_tagged_node(tx, label, properties, tag)

# Function to extract content between tags
def extract_content(line, tag):
    start = f'<{tag}>'
    end = f'</{tag}>'
    return line[line.find(start) + len(start):line.find(end)].strip()

# Function to extract nested content
def extract_nested_content(line, tag):
    start = f'<{tag}>'
    end = f'</{tag}>'
    return line[line.find(start) + len(start):line.rfind(end)].strip()

# Function to extract airplane types and line numbers from content
def extract_airplanes_and_lines(content):
    airplane_types = []
    line_numbers = []

    if 'Airplane(s), line number(s)' in content:
        parts = content.split('Airplane(s), line number(s)')
        airplane_types = parts[0].strip().split()  # Split airplane types by spaces
        line_numbers = [line.strip() for line in parts[1].strip().split(',')]  # Split line numbers by commas

    return airplane_types, line_numbers

# Function to create nodes and relationships recursively
def create_nodes_and_relationships(tx, parent_node_id, element, tag_name=None):
    for child in element.splitlines():
        child = child.strip()
        if child.startswith('<effectivity>'):
            effectivity_node_id = create_tagged_node(tx, 'effectivity', {"name": 'effectivity'}, "added_for_bulletin")
            create_relationship(tx, parent_node_id, effectivity_node_id, 'effectivity')
            create_relationship(tx, effectivity_node_id, parent_node_id, "included_in")

        elif child.startswith('<airplanes>'):
            airplanes_content = extract_content(child, 'airplanes')
            print(f"Airplanes content: {airplanes_content}")

            # Extract airplane types and line numbers
            airplane_types, line_numbers = extract_airplanes_and_lines(airplanes_content)
            print(f"Airplane types: {airplane_types}")
            print(f"Line numbers: {line_numbers}")

            # Create nodes and relationships for each airplane type
            for airplane_type in airplane_types:
                airplane_node_id = create_tagged_node(tx, "Airplane", {"name": airplane_type}, "added_for_bulletin")
                create_relationship(tx, effectivity_node_id, airplane_node_id, "effects")
                create_relationship(tx, airplane_node_id, effectivity_node_id, "affected_by")
                print(f"Created Airplane node: {airplane_type}")

                # Create or connect to existing LineNumber nodes and relationships
                for line_number in line_numbers:
                    line_number_node_id = match_or_create_tagged_node(tx, "LineNumber", {"name": line_number}, "added_for_bulletin")
                    create_relationship(tx, airplane_node_id, line_number_node_id, "includes")
                    create_relationship(tx, line_number_node_id, airplane_node_id, "included_in")
                    print(f"Created or connected to LineNumber node: {line_number}")
        else:
            if child.startswith('<') and child.endswith('>'):
                tag_name = child[1:-1].split()[0]
                content = extract_content(child, tag_name)
                if content:
                    node_id = create_tagged_node(tx, tag_name, {"name": tag_name, "content": content}, "added_for_bulletin")
                    create_relationship(tx, parent_node_id, node_id, tag_name)
                    create_relationship(tx, node_id, parent_node_id, "included_in")
                else:
                    nested_content = extract_nested_content(child, tag_name)
                    node_id = create_tagged_node(tx, tag_name, {"name": tag_name}, "added_for_bulletin")
                    create_relationship(tx, parent_node_id, node_id, tag_name)
                    create_relationship(tx, node_id, parent_node_id, "included_in")
                    create_nodes_and_relationships(tx, node_id, nested_content, tag_name)

# Process each XML file
with driver.session(database="newDatabase") as session:
    for xml_file in xml_files:
        # Read the XML file content as a string
        with open(xml_file, 'r') as file:
            xml_content = file.read()

        # Create the main service bulletin node
        bulletin_number = extract_content(xml_content, 'number')
        bulletin_node_id = session.write_transaction(create_tagged_node, "ServiceBulletin", {"name": bulletin_number}, "added_for_bulletin")

        # Create nodes and relationships from the XML
        session.write_transaction(create_nodes_and_relationships, bulletin_node_id, xml_content)

print("Graph created successfully.")

# Close the driver connection
driver.close()
