from py2neo import Graph, Node, Relationship
import xml.etree.ElementTree as ET
import re

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
        if child.tag == 'effectivity':
            effectivity_node = Node(child.tag, name=child.tag)
            relationship = Relationship(parent_node, child.tag, effectivity_node)
            reverse_relationship = Relationship(effectivity_node, "included_in", parent_node)
            graph.create(effectivity_node)
            graph.create(relationship)
            graph.create(reverse_relationship)

            airplanes_element = child.find('airplanes')
            if airplanes_element is not None:
                content = (airplanes_element.text or "").strip()
                print(f"Airplanes content: {content}")

                # Extract airplane types and line numbers
                airplane_match = re.search(r'(.*?) Airplane\(s\), line number\(s\)', content)
                if airplane_match:
                    airplane_types = re.findall(r'(\d+-\d+)', airplane_match.group(1))
                    line_numbers = re.findall(r'(\d+)', content[airplane_match.end():])
                
                print(f"Airplane types: {airplane_types}")
                print(f"Line numbers: {line_numbers}")
                
                # Create nodes and relationships for each airplane type
                for airplane_type in airplane_types:
                    airplane_node = Node("Airplane", name=airplane_type)
                    graph.create(airplane_node)
                    effectivity_relationship = Relationship(effectivity_node, "effects", airplane_node)
                    reverse_effectivity_relationship = Relationship(airplane_node, "affected_by", effectivity_node)
                    graph.create(effectivity_relationship)
                    graph.create(reverse_effectivity_relationship)
                    print(f"Created Airplane node: {airplane_type}")
                    
                    # Create or connect to existing LineNumber nodes and relationships
                    for line_number in line_numbers:
                        line_number_node = graph.nodes.match("LineNumber", name=line_number).first()
                        if line_number_node is None:
                            line_number_node = Node("LineNumber", name=line_number)
                            graph.create(line_number_node)
                        line_relationship = Relationship(airplane_node, "includes", line_number_node)
                        reverse_line_relationship = Relationship(line_number_node, "included_in", airplane_node)
                        graph.create(line_relationship)
                        graph.create(reverse_line_relationship)
                        print(f"Created or connected to LineNumber node: {line_number}")
        else:
            # Handle other nodes normally
            content = (child.text or "").strip()
            node = Node(child.tag, name=child.tag, content=content)
            relationship = Relationship(parent_node, child.tag, node)
            reverse_relationship = Relationship(node, "included_in", parent_node)
            graph.create(node)
            graph.create(relationship)
            graph.create(reverse_relationship)
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