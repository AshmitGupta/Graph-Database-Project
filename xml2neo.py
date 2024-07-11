from py2neo import Graph, Node, Relationship
import xml.etree.ElementTree as ET
import os

# Connect to the Neo4j instance
graph = Graph("bolt://localhost:7687", auth=("neo4j", "password"))

# List of XML files
xml_files = [
    'boeing_service_bulletin_1.xml',
    'boeing_service_bulletin_2.xml',
    'boeing_service_bulletin_3.xml'
]

# Function to create nodes and relationships recursively
def create_nodes_and_relationships(parent_node, element):
    for child in element:
        if child.tag is not None:
            content = (child.text or "").strip()
            node = Node(child.tag, name=child.tag, content=content)
            relationship = Relationship(parent_node, child.tag, node)
            graph.create(node)
            graph.create(relationship)
            create_nodes_and_relationships(node, child)

# Process each XML file
for xml_file in xml_files:
    # Parse the XML file
    tree = ET.parse(xml_file)
    root = tree.getroot()

    # Create the main service bulletin node
    bulletin_number = root.find('./header/number').text
    bulletin_node = Node("ServiceBulletin", name=bulletin_number)
    graph.create(bulletin_node)

    # Create nodes and relationships from the XML
    create_nodes_and_relationships(bulletin_node, root)

print("Graph created successfully.")